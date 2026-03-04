# Changelog - Clara Answers Automation Pipeline

## [1.0.0] - 2026-03-04

### Added
- **Core Pipeline**: Rule-based extraction engine for converting demo calls to Retell Agent Specs (v1).
- **Onboarding Engine**: Deep-merge logic to refine v1 specs with onboarding call data (v2).
- **Whisper Integration**: Local, zero-cost transcription stage for audio files (.m4a/.mp3).
- **Validation Suite**: Robust output validator with 400+ checks for schema compliance and logic consistency.
- **Web Dashboard**: Premium dark-mode dashboard for visualizing account memos and agent diffs.
- **n8n Workflows**: Industrial-grade JSON exports for Pipeline A (Demo) and Pipeline B (Onboarding).

### Account Focus: Ben's Electric
- Initial v1 generated from demo transcript.
- v2 refined via high-fidelity Whisper transcription of onboarding audio.
- Integrated specialized routing for GNM Pressure Washing (Gas Stations).
- Captured residential service fees ($115) and hourly rates ($98).
