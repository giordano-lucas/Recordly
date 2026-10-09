import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { ipcMain } from "electron";
import {
	buildSensitiveSpans,
	type ScannedFrame,
	type SensitiveSpan,
} from "../../../src/lib/sensitiveText";
import { ensureSensitiveTextScannerBinary } from "../paths/binaries";
import { resolveApprovedLocalMediaPath } from "../project/manager";

const SCAN_INTERVAL_MS = 500;

export type SensitiveTextScanResult =
	| { success: true; spans: SensitiveSpan[]; durationMs: number }
	| { success: false; error: string };

/**
 * Finds secrets on screen in a recording with on-device text recognition
 * (Apple Vision). Nothing leaves the machine. macOS only.
 */
export function registerSensitiveTextHandlers() {
	ipcMain.handle(
		"scan-sensitive-text",
		async (event, filePath: string): Promise<SensitiveTextScanResult> => {
			if (process.platform !== "darwin") {
				return { success: false, error: "Secret detection needs macOS text recognition." };
			}
			const resolved = filePath ? await resolveApprovedLocalMediaPath(filePath) : null;
			if (!resolved) return { success: false, error: "Recording is not available." };

			let binaryPath: string;
			try {
				binaryPath = await ensureSensitiveTextScannerBinary();
			} catch (error) {
				return { success: false, error: String(error) };
			}

			const frames: ScannedFrame[] = [];
			const child = spawn(binaryPath, [
				"--input",
				resolved,
				"--interval-ms",
				String(SCAN_INTERVAL_MS),
			]);
			let stderr = "";
			child.stderr.on("data", (chunk) => {
				stderr += String(chunk);
			});
			const lines = createInterface({ input: child.stdout });
			lines.on("line", (line) => {
				try {
					const message = JSON.parse(line);
					if (message.type === "frame") {
						frames.push({ t: message.t, tokens: message.tokens });
					} else if (message.type === "progress" && !event.sender.isDestroyed()) {
						event.sender.send("sensitive-text-scan-progress", {
							done: message.done,
							total: message.total,
						});
					}
				} catch {
					// Ignore partial or non-JSON output.
				}
			});
			const exitCode = await new Promise<number | null>((resolve) => {
				child.on("close", resolve);
				child.on("error", () => resolve(-1));
			});
			if (exitCode !== 0) {
				return {
					success: false,
					error: stderr.trim() || `Scanner exited with ${exitCode}`,
				};
			}
			const durationMs =
				frames.length > 0 ? frames[frames.length - 1].t + SCAN_INTERVAL_MS : 0;
			return {
				success: true,
				durationMs,
				spans: buildSensitiveSpans(frames, SCAN_INTERVAL_MS, durationMs),
			};
		},
	);
}
