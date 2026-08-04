<#
.SYNOPSIS
  Generates tests/integration/fixtures/spoken.wav: a synthetic-voice (SAPI),
  16kHz/16-bit/mono WAV of a ~10s passage with a few filler words, used only
  by the local Whisper integration test (tests/integration/whisper.test.ts).

.NOTES
  System.Speech ships with Windows (.NET Framework compat surface); no
  install needed. The voice is Windows' built-in SAPI TTS voice -- a
  synthetic voice, not a real person, so committing the resulting wav is
  fine (see task-13-brief.md).

  Run from anywhere:
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-sapi-fixture.ps1
#>

Add-Type -AssemblyName System.Speech

$repoRoot = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path -Path (Join-Path -Path (Join-Path -Path $repoRoot -ChildPath 'tests') -ChildPath 'integration') -ChildPath 'fixtures'
$outPath = Join-Path -Path $outDir -ChildPath 'spoken.wav'

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Deliberately includes a few "um"s and a couple of long-ish sentences so the
# integration test has both content words to match against and (optionally,
# not asserted on) filler tokens to look for.
$text = 'Hello, my name is a test voice. ' +
  'Um, I think the answer is that plants, um, convert light into energy through photosynthesis. ' +
  'This is, you know, quite remarkable.'

$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
  16000,
  [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
  [System.Speech.AudioFormat.AudioChannel]::Mono
)

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $synth.SetOutputToWaveFile($outPath, $format)
  $synth.Speak($text)
} finally {
  $synth.Dispose()
}

$bytes = (Get-Item $outPath).Length
Write-Host "Wrote $outPath ($bytes bytes)"
