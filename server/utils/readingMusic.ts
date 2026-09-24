import { READING_MUSIC_TRACKS, type ReadingMusicTrackId } from "../../shared/readingMusic";

const audioCache = new Map<ReadingMusicTrackId, Buffer>();
export const READING_MUSIC_SAMPLE_RATE = 44_100;
export const READING_MUSIC_DURATION_SECONDS = 24;

function writeWaveHeader(buffer: Buffer, sampleCount: number, sampleRate: number) {
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + sampleCount * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);
}

function buildTrack(trackId: ReadingMusicTrackId): Buffer {
  const sampleRate = READING_MUSIC_SAMPLE_RATE;
  const seconds = READING_MUSIC_DURATION_SECONDS;
  const sampleCount = sampleRate * seconds;
  const output = Buffer.allocUnsafe(44 + sampleCount * 2);
  writeWaveHeader(output, sampleCount, sampleRate);
  const trackIndex = READING_MUSIC_TRACKS.findIndex((track) => track.id === trackId);
  const root = [174, 196, 220, 130.81, 146.83][Math.max(0, trackIndex)];
  // Quantizing every oscillator to a whole number of cycles makes the buffer
  // loop without a discontinuity (and therefore without a click or restart).
  const seamlessFrequency = (frequency: number) => Math.round(frequency * seconds) / seconds;
  const frequencies = [
    seamlessFrequency(root / 2),
    seamlessFrequency(root),
    seamlessFrequency(root * 1.5),
    seamlessFrequency(root * 2),
  ];

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const breath = 0.72 + 0.14 * Math.sin(2 * Math.PI * time / seconds);
    const shimmer = 0.8 + 0.08 * Math.sin(4 * Math.PI * time / seconds);
    const pad =
      Math.sin(2 * Math.PI * frequencies[0] * time) * 0.28 +
      Math.sin(2 * Math.PI * frequencies[1] * time) * 0.16 +
      Math.sin(2 * Math.PI * frequencies[2] * time) * 0.075 +
      Math.sin(2 * Math.PI * frequencies[3] * time) * 0.035;
    const sample = Math.max(-1, Math.min(1, pad * breath * shimmer));
    output.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  return output;
}

export function getReadingMusicTrack(trackId: unknown): Buffer | null {
  const id = String(trackId || "") as ReadingMusicTrackId;
  if (!READING_MUSIC_TRACKS.some((track) => track.id === id)) return null;
  const cached = audioCache.get(id);
  if (cached) return cached;
  const audio = buildTrack(id);
  audioCache.set(id, audio);
  return audio;
}
