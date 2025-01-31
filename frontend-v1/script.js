import { KokoroTTS } from 'kokoro-js';

document.addEventListener('DOMContentLoaded', async () => {
    const textInput = document.getElementById('textInput');
    const ttsButton = document.getElementById('ttsButton');
    const audioOutput = document.getElementById('audioOutput');

    // Initialize TTS model
    console.log('Initializing TTS...');
    const model_id = "onnx-community/Kokoro-82M-ONNX";
    const tts = await KokoroTTS.from_pretrained(model_id, {
        dtype: "q8",
    });
    console.log('TTS initialized successfully');

    ttsButton.addEventListener('click', async () => {
        const text = textInput.value;
        if (text) {
            try {
                const audio = await tts.generate(text, { voice: 'af_nicole' }); // Example voice
                const audioBlob = new Blob([audio.data], { type: 'audio/wav' });
                const audioUrl = URL.createObjectURL(audioBlob);
                audioOutput.src = audioUrl;
                audioOutput.play();
            } catch (error) {
                console.error("TTS generation failed:", error);
                alert('Text-to-speech synthesis failed.');
            }
        } else {
            alert('Please enter text to synthesize.');
        }
    });
});
