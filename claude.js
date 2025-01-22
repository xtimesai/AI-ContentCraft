import express from 'express';
import { KokoroTTS } from "kokoro-js";
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
import * as genai from '@google/generative-ai';

dotenv.config();

// Define execAsync
const execAsync = promisify(exec);

// Construct __dirname for ES Modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;

// Set up middleware
app.use(express.json());
app.use(express.static(__dirname));
app.use('/output', express.static(path.join(__dirname, 'output')));

// Create output directory - moved this to an async function so server can start after resources are ready
async function initializeApp() {
    try {
        await fs.mkdir(path.join(__dirname, 'output'), { recursive: true });

        // Initialize TTS
        console.log('Initializing TTS...');
        const model_id = "onnx-community/Kokoro-82M-ONNX";
        const tts = await KokoroTTS.from_pretrained(model_id, {
            dtype: "q8",
        });
        console.log('TTS initialized successfully');

        // Initialize Gemini API client
        const gemini = new genai.GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = gemini.getGenerativeModel({ model: "gemini-pro" });

        // API Routes
        app.get('/voices', async (req, res) => {
            console.log('GET /voices request received');
            // Hardcoded voice list
            const voices = [
                { id: "af", name: "Default", language: "en-us", gender: "Female" },
                { id: "af_bella", name: "Bella", language: "en-us", gender: "Female" },
                { id: "af_nicole", name: "Nicole", language: "en-us", gender: "Female" },
                { id: "af_sarah", name: "Sarah", language: "en-us", gender: "Female" },
                { id: "af_sky", name: "Sky", language: "en-us", gender: "Female" },
                { id: "am_adam", name: "Adam", language: "en-us", gender: "Male" },
                { id: "am_michael", name: "Michael", language: "en-us", gender: "Male" },
                { id: "bf_emma", name: "Emma", language: "en-gb", gender: "Female" },
                { id: "bf_isabella", name: "Isabella", language: "en-gb", gender: "Female" },
                { id: "bm_george", name: "George", language: "en-gb", gender: "Male" },
                { id: "bm_lewis", name: "Lewis", language: "en-gb", gender: "Male" }
            ];
            res.json(voices);
        });

        app.post('/generate', async (req, res) => {
            const { text, voice = "af_nicole" } = req.body;

            try {
                const audio = await tts.generate(text, {
                    voice: voice,
                });
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

        app.post('/generate-and-merge', async (req, res) => {
            const { sections } = req.body;
            if (!sections || sections.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No valid text sections'
                });
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const outputFile = path.join(__dirname, `output/${timestamp}/audio.wav`);

            try {
                const tempDir = path.join(__dirname, 'temp');
                const outputDir = path.join(__dirname, 'output', timestamp);
                await fs.mkdir(tempDir, { recursive: true });
                await fs.mkdir(outputDir, { recursive: true });

                const audioFiles = [];
                for (let i = 0; i < sections.length; i++) {
                    const { text, voice } = sections[i];

                    res.write(JSON.stringify({
                        type: 'progress',
                        current: i + 1,
                        total: sections.length,
                        message: `Generating audio for section ${i + 1}/${sections.length}`
                    }) + '\n');

                    try {
                        const audio = await tts.generate(text, { voice });
                        const tempFile = path.join(tempDir, `temp-${i}.wav`);
                        await audio.save(tempFile);
                        audioFiles.push(tempFile);
                    } catch (error) {
                        console.error(`Error generating audio for section ${i}:`, error);
                        res.write(JSON.stringify({
                            type: 'error',
                            message: `Failed to generate audio for section ${i + 1}: ${error.message}`
                        }) + '\n');
                    }
                }

                if (audioFiles.length > 0) {
                    res.write(JSON.stringify({
                        type: 'status',
                        message: 'Merging audio files...'
                    }) + '\n');

                    const listFile = path.join(tempDir, `list-${timestamp}.txt`);
                    const fileList = audioFiles.map(f => `file '${f}'`).join('\n');
                    await fs.writeFile(listFile, fileList);

                    const ffmpegPath = '/opt/homebrew/bin/ffmpeg';
                    await execAsync(`"${ffmpegPath}" -f concat -safe 0 -i "${listFile}" -c copy "${outputFile}"`);

                    try {
                        await Promise.all(audioFiles.map(f => fs.unlink(f)));
                        await fs.unlink(listFile);
                    } catch (err) {
                        console.error('Error cleaning temp files', err);
                    }

                    try {
                        await fs.rm(tempDir, { recursive: true });
                    } catch (err) {
                        try {
                            const files = await fs.readdir(tempDir);
                            for (const file of files) {
                                await fs.unlink(path.join(tempDir, file))
                            }
                            await fs.rm(tempDir, { recursive: true });
                        } catch (err) {
                            console.error('Error removing temp dir, and trying to clean files first', err);
                        }
                    }

                    res.write(JSON.stringify({
                        type: 'complete',
                        success: true,
                        filename: path.relative(__dirname, outputFile)
                    }));
                    res.end();
                } else {
                    throw new Error('No audio generated');
                }
            } catch (error) {
                console.error('Error generating and merging audio:', error);
                res.write(JSON.stringify({
                    type: 'error',
                    error: error.message
                }));
                res.end();
            }
        });

        app.post('/generate-story', async (req, res) => {
            const { theme } = req.body;
            try {
                const prompt = `You are a professional story writer. Create engaging and interesting short stories with good plot development. Write a short story about "${theme}" in around 200 words`;

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const story = response.text();

                res.json({
                    success: true,
                    story: story
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        app.post('/generate-script', async (req, res) => {
            const { story } = req.body;

            res.write(JSON.stringify({
                type: 'status',
                message: 'Converting story to script...'
            }) + '\n');

            try {
                const prompt = `Convert stories into dialogue format and return JSON format with these requirements:
                1. Convert any non-English text to English first
                2. Separate narration and dialogues
                3. Do not use asterisks (*) or any special formatting characters
                4. Format: 
                {
                "scenes": [
                    {
                    "type": "narration",
                    "text": "scene description or narration"
                    },
                    {
                    "type": "dialogue",
                    "character": "Character Name",
                    "text": "dialogue content"
                    }
                ]
                }
                5. Keep dialogues natural and concise
                6. Add scene descriptions where needed
                7. Maintain story flow and emotion
                8. Use appropriate names for characters
                Convert this story into script format:\n${story}`;

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const scriptContent = response.text();

                res.write(JSON.stringify({
                    type: 'status',
                    message: 'Processing script format...'
                }) + '\n');

                let scriptData;
                try {
                    const jsonMatch = scriptContent.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        scriptData = JSON.parse(jsonMatch[0]);
                    } else {
                        throw new Error('Invalid script format');
                    }
                    if (!scriptData.scenes || !Array.isArray(scriptData.scenes)) {
                        throw new Error('Invalid script structure');
                    }

                    scriptData.scenes = scriptData.scenes.map(scene => ({
                        ...scene,
                        text: scene.text.replace(/\*/g, ''),
                        ...(scene.character && { character: scene.character.replace(/\*/g, '') })
                    }));

                    res.write(JSON.stringify({
                        type: 'complete',
                        success: true,
                        script: scriptData
                    }) + '\n');
                    res.end();
                } catch (error) {
                    console.error('Script parsing error:', error);
                    console.error('Raw script content:', scriptContent);
                    throw new Error('Failed to parse script format');
                }

            } catch (error) {
                console.error('Script generation error:', error);
                res.write(JSON.stringify({
                    type: 'error',
                    error: error.message
                }) + '\n');
                res.end();
            }
        });

        app.post('/generate-podcast', async (req, res) => {
            const { topic } = req.body;
            try {
                const prompt = `You are a professional podcast content creator. Create engaging and informative podcast content that is suitable for a conversation between two hosts. Create a podcast discussion outline about "${topic}". The content should be informative and conversational.`;

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const content = response.text();

                res.json({
                    success: true,
                    content: content
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        app.post('/generate-podcast-script', async (req, res) => {
            const { content } = req.body;
            try {
                const prompt = `Convert content into a natural English conversation between two podcast hosts (A and B). Requirements:
                1. Format the response as JSON array of dialog objects
                2. Each object should have 'host' (either 'A' or 'B') and 'text' fields
                3. Keep the conversation natural and engaging
                4. Convert any non-English content to English
                Format example:
                [
                    {"host": "A", "text": "Welcome to our show..."},
                    {"host": "B", "text": "Today we're discussing..."}
                ]
                Convert this content into a podcast conversation:\n${content}`;

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const scriptContent = response.text();

                let scriptData;
                try {
                    scriptData = JSON.parse(scriptContent);
                } catch (e) {
                    const jsonMatch = scriptContent.match(/\[[\s\S]*\]/);
                    if (jsonMatch) {
                        scriptData = JSON.parse(jsonMatch[0]);
                    } else {
                        throw new Error('Invalid script format');
                    }
                }

                res.json({
                    success: true,
                    script: scriptData
                });
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });

        app.post('/generate-image-prompt', async (req, res) => {
            const { text, context } = req.body;

            if (!text) {
                return res.status(400).json({
                    success: false,
                    error: 'Text is required'
                });
            }

            console.log('Generating prompt for text:', text);

            try {
                const prompt = `You are a professional image prompt engineer. Create concise and detailed image prompts that maintain consistency and are appropriate for all audiences.

                Requirements:
                1. Keep prompts under 75 words
                2. Focus on key visual elements and maintain character/setting consistency. Do not focus on emotions, or subjective descriptions.
                3. Include artistic style and mood but avoid any description that could be considered sensitive or inappropriate. Focus on descriptive terms for the visual elements, such as colors, lighting, style (e.g. realistic, cartoonish, painting etc.), and scene composition.
                4. Do not include any potentially offensive, or NSFW subject matter, or any descriptions of violence, suffering, or anything that could be considered disturbing.
                5. Use natural, descriptive language, focusing on visual elements (colors, objects, shapes, environment). Do not describe emotions, moods, or subjective impressions.
                6. Output in English only
                Story context:
                ${context || 'No context provided'}
                Create an image generation prompt for this scene that is family-friendly and follows the requirements: "${text}"`;

                const result = await model.generateContent(prompt);
                const response = await result.response;
                const generatedPrompt = response.text();

                console.log('Generated prompt:', generatedPrompt);

                res.json({
                    success: true,
                    prompt: generatedPrompt
                });
            } catch (error) {
                console.error('Prompt generation error:', error);
                res.status(500).json({
                    success: false,
                    error: error.message || 'Failed to generate prompt'
                });
            }
        });

        // Updated generate-image route
        app.post('/generate-image', async (req, res) => {
            const { prompt, sectionId } = req.body;

            if (!prompt) {
                return res.status(400).json({
                    success: false,
                    error: 'Prompt is required'
                });
            }

            console.log('Generating image for prompt:', prompt);

            try {
                const model = gemini.getGenerativeModel({ model: "imagen-3.0-generate-002" });
                const result = await model.generateContent({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }]