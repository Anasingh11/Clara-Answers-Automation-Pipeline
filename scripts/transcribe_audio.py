import os
import sys
import argparse
import whisper
from datetime import datetime

def transcribe(file_path, output_dir, account_id=None, company_name=None):
    """
    Transcribes an audio file using OpenAI's Whisper (local).
    Outputs a formatted text file for the Clara Pipeline.
    """
    # Add FFmpeg to PATH for Windows if winget installed it
    ffmpeg_dir = r"C:\Users\HP\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin"
    if os.path.exists(ffmpeg_dir) and ffmpeg_dir not in os.environ["PATH"]:
        os.environ["PATH"] += os.pathsep + ffmpeg_dir

    if not os.path.exists(file_path):
        print(f"Error: File not found: {file_path}")
        return

    print(f"--- Loading Whisper model (base) ---")
    model = whisper.load_model("base")

    print(f"--- Transcribing: {os.path.basename(file_path)} ---")
    result = model.transcribe(file_path)
    text = result["text"].strip()

    # Determine account info if not provided
    if not account_id:
        # Inferred from filename e.g. onboarding_bens_electric.m4a
        filename = os.path.basename(file_path)
        account_id = filename.split('.')[0].replace('onboarding_', '').replace('demo_', '')
    
    if not company_name:
        company_name = account_id.replace('_', ' ').title()

    # Format timing
    now = datetime.now().strftime("%Y-%m-%d")
    
    header = f"""[Onboarding Call Transcript]
Account: {company_name} ({account_id})
Date: {now}
Participants: Clara (AI), Customer (User)

---

Customer: {text}
"""

    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)
    
    # Generate output filename
    output_filename = os.path.basename(file_path).split('.')[0] + ".txt"
    output_path = os.path.join(output_dir, output_filename)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(header)

    print(f"--- SUCCESS ---")
    print(f"Transcript saved to: {output_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Transcribe audio for Clara Pipeline")
    parser.add_argument("file", help="Path to audio file (m4a, mp3, wav)")
    parser.add_argument("--type", choices=["demo", "onboarding"], default="onboarding", help="Type of call")
    parser.add_argument("--id", help="Account ID Override")
    parser.add_argument("--company", help="Company Name Override")

    args = parser.parse_args()

    # Determine target directories relative to project root
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    
    target_dir = os.path.join(project_root, "data", args.type)

    transcribe(args.file, target_dir, args.id, args.company)
