import { type MutableRefObject, useCallback, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { buildAutoBlurAnnotations, isAutoBlur } from "../autoBlur";
import type { useTimelineState } from "../state/useTimelineState";
import type { CropRegion } from "../types";

interface Input {
	sourcePath: string | null;
	timeline: ReturnType<typeof useTimelineState>;
	cropRegion: CropRegion;
	nextAnnotationIdRef: MutableRefObject<number>;
	nextAnnotationZIndexRef: MutableRefObject<number>;
}

/**
 * Scans the recording for secrets with on-device text recognition and covers
 * each one with a blur for as long as it is on screen. Re-running replaces the
 * previous automatic blurs; manual blurs are never touched.
 */
export function useAutoBlurSecrets(input: Input) {
	const [isScanning, setIsScanning] = useState(false);
	const inputRef = useRef(input);
	inputRef.current = input;

	const autoBlurSecrets = useCallback(async () => {
		const { sourcePath } = inputRef.current;
		const api = window.electronAPI;
		if (!sourcePath || !api?.scanSensitiveText) {
			toast.error("Secret detection is not available for this recording");
			return;
		}
		setIsScanning(true);
		const toastId = "auto-blur-secrets";
		toast.info("Scanning the recording for secrets…", { id: toastId, duration: Infinity });
		const unsubscribe = api.onSensitiveTextScanProgress?.(({ done, total }) => {
			toast.info(`Scanning the recording for secrets… ${Math.round((done / total) * 100)}%`, {
				id: toastId,
				duration: Infinity,
			});
		});
		try {
			const result = await api.scanSensitiveText(sourcePath);
			if (!result.success) {
				toast.dismiss(toastId);
				toast.error(`Secret detection failed: ${result.error}`);
				return;
			}
			const { timeline, cropRegion, nextAnnotationIdRef, nextAnnotationZIndexRef } =
				inputRef.current;
			const kept = timeline.annotationRegions.filter((region) => !isAutoBlur(region));
			const blurs = buildAutoBlurAnnotations({
				spans: result.spans,
				clips: timeline.clipRegions,
				crop: cropRegion,
				existing: kept,
				createId: () => `annotation-${nextAnnotationIdRef.current++}`,
				nextZIndex: () => nextAnnotationZIndexRef.current++,
			});
			timeline.setAnnotationRegions((current) => [
				...current.filter((region) => !isAutoBlur(region)),
				...blurs,
			]);
			const replaced = timeline.annotationRegions.length - kept.length;
			toast.dismiss(toastId);
			toast.success(
				blurs.length === 0
					? "No secrets found on screen"
					: `Blurred ${result.spans.length} secret${result.spans.length === 1 ? "" : "s"} on screen` +
							(replaced > 0 ? " (replaced the previous automatic blurs)" : ""),
			);
		} catch (error) {
			toast.dismiss(toastId);
			toast.error(`Secret detection failed: ${String(error)}`);
		} finally {
			unsubscribe?.();
			setIsScanning(false);
		}
	}, []);

	return { isScanning, autoBlurSecrets };
}
