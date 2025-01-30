import express from 'express';
import { KokoroTTS } from "kokoro-js";
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
import Replicate from "replicate";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs_sync from 'fs';

// Load environment variables
dotenv.config();

// Define constants and initialize basic variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);
const app = express();
const port = process.env.PORT || 3000;

// Configure middleware
app.use(express.json());
app.use(express.static(__dirname));
app.use('/output', express.static(path.join(__dirname, 'output')));

// Initialize TTS and other services
let tts;
let replicate;
let geminiModel;

// Function to transcribe audio using WhisperX
async function transcribeAudio(mp3Path) {
    return new Promise(async (resolve, reject) => {
        try {
            console.log('transcribeAudio: Starting transcription process...');
             const command = `whisperx "${mp3Path}" --model medium.en --output_format txt`;
             console.log('transcribeAudio: whisperx command:', command);
            const { stdout, stderr } = await execAsync(command);

            if (stderr) {
                console.error('transcribeAudio: whisperx stderr:', stderr);
                // Even if there's an error in whisperx, don't reject, but return an error message
            }

            console.log('transcribeAudio: whisperx stdout:', stdout);
            const transcribedText = stdout.trim();
             if (!transcribedText) {
                    console.error('transcribeAudio: No transcription found');
                    resolve('No transcription found');
                }
             else
             {
                  console.log('transcribeAudio: Transcription completed successfully');
            resolve(transcribedText);
             }



        } catch (error) {
            console.error('transcribeAudio: whisperx transcription error:', error);
           reject('Transcription failed: ' + error.message);

        }
    });
}

// YouTube download function with yt-dlp, extracting title
async function downloadYouTubeAudio(url, outputDir = null) {
    return new Promise(async (resolve, reject) => {
        try {
            const output_path = outputDir || path.join(__dirname, 'output');

            // 1. Extract Video Title using yt-dlp
            let videoTitle;
            try {
                const titleCommand = `yt-dlp --get-filename -o "%(title)s" "${url}"`;
                console.log('downloadYouTubeAudio: yt-dlp title command:', titleCommand);
                const { stdout: titleStdout, stderr: titleStderr } = await execAsync(titleCommand);

                if (titleStderr) {
                    console.error('downloadYouTubeAudio: yt-dlp title stderr:', titleStderr);
                    //  Don't reject the whole process if title extraction fails
                }

                videoTitle = titleStdout.trim();
                console.log('downloadYouTubeAudio: yt-dlp title:', videoTitle);
                if (!videoTitle) {
                    videoTitle = "audio_download"; // fallback if title extraction fails
                    console.log('downloadYouTubeAudio: Falling back to default title:', videoTitle);
                }

            } catch (titleError) {
                console.error('downloadYouTubeAudio: yt-dlp title extraction error:', titleError);
                videoTitle = "audio_download"; // fallback if title extraction fails
                console.log('downloadYouTubeAudio: Falling back to default title due to error:', videoTitle);
            }

            // 2. Sanitize the title for use as a filename (UPDATED REGEX)
            const safeTitle = videoTitle.replace(/[\\/:*?"<>|]+/g, '').trim();
            const mp3Path = path.join(output_path, `${safeTitle}.mp3`);

            // Ensure output directory exists
            if (!fs_sync.existsSync(output_path)) {
                console.log('downloadYouTubeAudio: Creating output directory');
                fs_sync.mkdirSync(output_path, { recursive: true });
            }
            console.log('downloadYouTubeAudio: Output directory ensured');

            // 3. Download Audio using yt-dlp
            const downloadCommand = `yt-dlp -x --audio-format mp3 -o "${mp3Path}" "${url}"`;
            console.log('downloadYouTubeAudio: yt-dlp download command:', downloadCommand);
            const { stdout: downloadStdout, stderr: downloadStderr } = await execAsync(downloadCommand);

            if (downloadStderr) {
                console.error('downloadYouTubeAudio: yt-dlp download stderr:', downloadStderr);
            }
            console.log('downloadYouTubeAudio: yt-dlp download stdout:', downloadStdout);

            // Check for existing transcript
            const transcriptCommand = `yt-dlp --skip-download --write-auto-subs --sub-langs "en.*" --sub-format json3 -o "%(id)s" "${url}"`;

            console.log('downloadYouTubeAudio: yt-dlp transcript command:', transcriptCommand);
            let transcriptExists = false;
            try {
                const { stdout: transcriptStdout, stderr: transcriptStderr } = await execAsync(transcriptCommand);
                if (transcriptStderr) {
                    console.error('downloadYouTubeAudio: yt-dlp transcript stderr:', transcriptStderr);
                }
                const transcriptOutput = transcriptStdout.trim();
                if (transcriptOutput) {
                    console.log('downloadYouTubeAudio: YouTube transcript found:', transcriptOutput);
                    transcriptExists = true;
                    // Write transcript to a file
                    const transcriptPath = path.join(output_path, `${safeTitle}.json`);
                    await fs.writeFile(transcriptPath, transcriptOutput);
                    console.log(`downloadYouTubeAudio: Transcript saved to ${transcriptPath}`);
                    resolve(mp3Path);
                    return; // Exit the function early
                }
            } catch (transcriptError) {
                console.error('downloadYouTubeAudio: Error checking for YouTube transcript:', transcriptError);
            }

            if (!transcriptExists) {
                // 4. Transcribe audio after download using WhisperX
                try {
                    console.log('downloadYouTubeAudio: Starting audio transcription process...');
                    const transcription = await transcribeAudio(mp3Path);
                    console.log('downloadYouTubeAudio: Transcription:', transcription);
                } catch (transcriptionError) {
                    console.error('downloadYouTubeAudio: Error during transcription:', transcriptionError);
                }
            }

            resolve(mp3Path);

        } catch (error) {
            console.error('downloadYouTubeAudio: yt-dlp download function error:', error);
            reject(error);
        }
    });
}

// Initialize server and services
async function initializeServer() {
    try {
        // Create output directory
        await fs.mkdir(path.join(__dirname, 'output'), { recursive: true });

        // Initialize TTS
        console.log('Initializing TTS...');
        tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-ONNX", {
            dtype: "q8",
        });
        console.log('TTS initialized successfully');

        // Initialize Replicate if API token is available
        if (process.env.REPLICATE_API_TOKEN) {
            replicate = new Replicate({
                auth: process.env.REPLICATE_API_TOKEN,
            });
            console.log('Replicate initialized successfully');
        }

        // Initialize Gemini if API key is available
        if (process.env.GEMINI_API_KEY) {
            const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
            geminiModel = gemini.getGenerativeModel({ model: "gemini-pro" });
            console.log('Gemini initialized successfully');
        }

        // Define routes after services are initialized
        setupRoutes();

        // Start the server
        app.listen(port, '0.0.0.0', () => {
            console.log(`Server running at http://localhost:${port}`);
        });

    } catch (error) {
        console.error('Failed to initialize server:', error);
        process.exit(1);
    }
}

// Setup all routes
function setupRoutes() {
    // Get available voices
    app.get('/voices', (req, res) => {
        const voices = [
            { id: "af", name: "Default", language: "en-us", gender: "Female" },
            { id: "af_bella", name: "Bella", language: "en-us", gender: "Female" },
            { id: "af_nicole", name: "Nicole", language: "en-us", gender: "Female" },
            { id: "af_sarah", name: "Sarah", language: "en-us", gender: "Female" },
            { id: "af_sky", name: "Sky", language: "en-us", gender: "Female" },
            { id: "am_adam", name: "Adam", language: "en-us", gender: "Male" },
            { id: "am_michael", name: "Michael", language: "en-us", gender: "Male" }
        ];
        res.json(voices);
    });

    // Generate audio
    app.post('/generate', async (req, res) => {
        try {
            const { text, voice = "af_nicole" } = req.body;
            const audio = await tts.generate(text, { voice });
            res.json({
                success: true,
                audioData: audio.data
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Updated route handler with better error reporting
    app.post('/download-youtube-audio', async (req, res) => {
        console.log('Received download request');
        try {
            const { youtubeUrl } = req.body;
            console.log('YouTube URL:', youtubeUrl);

            if (!youtubeUrl) {
                console.log('No URL provided');
                return res.status(400).json({
                    success: false,
                    error: 'YouTube URL is required'
                });
            }

            console.log('Starting download process...');
            const mp3FilePath = await downloadYouTubeAudio(youtubeUrl);

            console.log('Download successful:', mp3FilePath);
            res.json({
                success: true,
                filePath: path.relative(__dirname, mp3FilePath)
            });
        } catch (error) {
            console.error('Download route error:', error);
            console.error('Detailed error:', error); // Log the full error object
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to download audio'
            });
        }
    });

    // Generate story
    app.post('/generate-story', async (req, res) => {
        try {
            const { theme } = req.body;
            const prompt = `Create a short story about "${theme}" in around 200 words`;
            const result = await geminiModel.generateContent(prompt);
            const response = await result.response;
            res.json({
                success: true,
                story: response.text()
            });
        } catch (error) {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });

    // Error handler
    app.use((err, req, res, next) => {
        console.error(err.stack);
        res.status(500).json({
            success: false,
            error: 'Something went wrong!'
        });
    });
}

// Start the server
initializeServer().catch(error => {
    console.error('Critical error during server initialization:', error);
    process.exit(1);
});