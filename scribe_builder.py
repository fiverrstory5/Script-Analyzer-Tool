import json
import asyncio
import edge_tts
import os

# --- Voice & Speed Settings ---
ENGLISH_VOICE = "en-US-AriaNeural"
HINDI_VOICE   = "hi-IN-SwaraNeural"

# --- Concurrency Control ---
# Max simultaneous requests to the TTS server. Raise if you want more speed,
# lower if you hit rate-limit errors.
MAX_CONCURRENT = 10


async def generate_audio(semaphore: asyncio.Semaphore, text: str, voice: str,
                         filename: str, rate: str = "+0%") -> None:
    """Generate a single audio file, gated by the shared semaphore.

    Smart Resume: if the MP3 already exists on disk the TTS request is
    skipped entirely, preserving bandwidth and avoiding duplicate work.
    """
    if os.path.exists(filename):
        print(f"  [Skip] File already exists: {filename}")
        return

    async with semaphore:
        communicate = edge_tts.Communicate(text, voice, rate=rate)
        await communicate.save(filename)


async def process_item(semaphore: asyncio.Semaphore, item: dict) -> None:
    """Schedule all three audio files for one script line concurrently."""
    line_id        = item["id"]
    eng_file       = f"audios/{line_id}_english.mp3"
    trans_file     = f"audios/{line_id}_translate.mp3"
    mean_file      = f"audios/{line_id}_meaning.mp3"

    await asyncio.gather(
        generate_audio(semaphore, item["english_line"],    ENGLISH_VOICE, eng_file,   rate="+10%"),
        generate_audio(semaphore, item["hindi_translate"], HINDI_VOICE,   trans_file, rate="+30%"),
        generate_audio(semaphore, item["hindi_meaning"],   HINDI_VOICE,   mean_file,  rate="+30%"),
    )
    print(f"  ✅ ID {line_id} — done (missing files generated, existing files skipped)")


async def main() -> None:
    os.makedirs("audios", exist_ok=True)

    with open("data.json", "r", encoding="utf-8") as f:
        script_data = json.load(f)

    total = len(script_data)
    print(f"🚀 Starting concurrent audio generation for {total} lines "
          f"(max {MAX_CONCURRENT} simultaneous requests)...\n")

    semaphore = asyncio.Semaphore(MAX_CONCURRENT)

    # Create one task per script line — all lines run concurrently,
    # but the semaphore caps the live TTS requests at MAX_CONCURRENT.
    tasks = [
        asyncio.create_task(process_item(semaphore, item))
        for item in script_data
    ]
    await asyncio.gather(*tasks)

    print(f"\n🎉 Done! All {total * 3} audio files saved to the 'audios/' folder.")


if __name__ == "__main__":
    asyncio.run(main())