import AVFoundation
import CoreGraphics
import Foundation
import Vision

// Samples frames from a recording and runs on-device text recognition on each.
// Writes one JSON object per line to stdout:
//   {"type":"progress","done":N,"total":M}
//   {"type":"frame","t":ms,"tokens":[{"text":"…","box":[x,y,w,h]}],"lines":["…"]}
// Boxes are normalized to the frame with a top-left origin.
//
// Usage: recordly-text-scan --input <video> [--interval-ms 500]

struct Token: Encodable {
	let text: String
	let box: [Double]
}

struct FrameResult: Encodable {
	let type = "frame"
	let t: Int
	let tokens: [Token]
	let lines: [String]
}

struct Progress: Encodable {
	let type = "progress"
	let done: Int
	let total: Int
}

let encoder = JSONEncoder()

func emit<T: Encodable>(_ value: T) {
	guard let data = try? encoder.encode(value), let line = String(data: data, encoding: .utf8)
	else { return }
	FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func fail(_ message: String) -> Never {
	FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
	exit(1)
}

func argument(_ name: String) -> String? {
	let args = CommandLine.arguments
	guard let index = args.firstIndex(of: name), index + 1 < args.count else { return nil }
	return args[index + 1]
}

/// A 32x18 grayscale thumbnail, used to skip OCR on frames that did not change.
func fingerprint(_ image: CGImage) -> [UInt8] {
	let width = 32
	let height = 18
	var pixels = [UInt8](repeating: 0, count: width * height)
	guard
		let context = CGContext(
			data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width,
			space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
	else { return pixels }
	context.interpolationQuality = .low
	context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
	return pixels
}

func meanDifference(_ left: [UInt8], _ right: [UInt8]) -> Double {
	guard left.count == right.count, !left.isEmpty else { return .infinity }
	var total = 0
	for index in 0..<left.count { total += abs(Int(left[index]) - Int(right[index])) }
	return Double(total) / Double(left.count)
}

func recognize(_ image: CGImage) -> (tokens: [Token], lines: [String]) {
	let request = VNRecognizeTextRequest()
	request.recognitionLevel = .accurate
	// Secrets are not words; correction would "fix" them into something else.
	request.usesLanguageCorrection = false
	request.minimumTextHeight = 0.008
	let handler = VNImageRequestHandler(cgImage: image, options: [:])
	do { try handler.perform([request]) } catch { return ([], []) }

	var tokens: [Token] = []
	var lines: [String] = []
	for observation in request.results ?? [] {
		guard let candidate = observation.topCandidates(1).first else { continue }
		let text = candidate.string
		lines.append(text)
		var searchStart = text.startIndex
		for word in text.split(whereSeparator: { $0 == " " || $0 == "\t" }) {
			guard let range = text.range(of: String(word), range: searchStart..<text.endIndex)
			else { continue }
			searchStart = range.upperBound
			guard let rect = try? candidate.boundingBox(for: range)?.boundingBox else { continue }
			// Vision uses a bottom-left origin.
			tokens.append(
				Token(
					text: String(word),
					box: [
						Double(rect.minX), Double(1 - rect.maxY), Double(rect.width), Double(rect.height),
					]))
		}
	}
	return (tokens, lines)
}

guard let inputPath = argument("--input") else { fail("Missing --input <video>") }
let intervalMs = max(100, Int(argument("--interval-ms") ?? "500") ?? 500)

let asset = AVURLAsset(url: URL(fileURLWithPath: inputPath))
let semaphore = DispatchSemaphore(value: 0)
var durationSeconds = 0.0
Task {
	durationSeconds = (try? await asset.load(.duration).seconds) ?? 0
	semaphore.signal()
}
semaphore.wait()
guard durationSeconds.isFinite, durationSeconds > 0 else { fail("Unreadable video duration") }

let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
let tolerance = CMTime(value: Int64(intervalMs / 4), timescale: 1000)
generator.requestedTimeToleranceBefore = tolerance
generator.requestedTimeToleranceAfter = tolerance

let totalMs = Int(durationSeconds * 1000)
let times = Array(stride(from: 0, to: totalMs, by: intervalMs))
var previousFingerprint: [UInt8] = []
var previous: (tokens: [Token], lines: [String]) = ([], [])

for (index, timeMs) in times.enumerated() {
	let time = CMTime(value: Int64(timeMs), timescale: 1000)
	guard let image = try? generator.copyCGImage(at: time, actualTime: nil) else { continue }
	let frameFingerprint = fingerprint(image)
	if meanDifference(frameFingerprint, previousFingerprint) > 0.5 {
		previous = recognize(image)
		previousFingerprint = frameFingerprint
	}
	emit(FrameResult(t: timeMs, tokens: previous.tokens, lines: previous.lines))
	emit(Progress(done: index + 1, total: times.count))
}
