import express from 'express';
import { KokoroTTS } from "kokoro-js";
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from "@google/generative-ai";
import fetch from 'node-fetch'; // Import fetch

dotenv.config();

// Define execAsync
const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;

// Set up middleware
app.use(express.json());
app.use(express.static(__dirname));
app.use('/output', express.static(path.join(__dirname, 'output')));

// Create output directory
await fs.mkdir(path.join(__dirname, 'output'), { recursive: true });

// Initialize TTS
console.log('Initializing TTS...');
const model_id = "onnx-community/Kokoro-82M-ONNX";
const tts = await KokoroTTS.from_pretrained(model_id, {
    dtype: "q8",
});
console.log('TTS initialized successfully');

// Initialize Gemini API client
const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
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
        // Return audio data instead of saving file
        res.json({ 
            success: true,
            audioData: audio.data // Returns audio data
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Modify route to generate and merge audio
app.post('/generate-and-merge', async (req, res) => {
    const { sections } = req.body;
    if (!sections || sections.length === 0) {
        return res.status(400).json({ 
            success: false, 
            error: 'No valid text sections' 
        });
    }

    // Improved file name generation logic
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFile = path.join(__dirname, `output/${timestamp}/audio.wav`);
    
    try {
        // Create temporary directory and output directory
        const tempDir = path.join(__dirname, 'temp');
        const outputDir = path.join(__dirname, 'output', timestamp);
        await fs.mkdir(tempDir, { recursive: true });
        await fs.mkdir(outputDir, { recursive: true });
        
        // Generate all audio files
        const audioFiles = [];
        for (let i = 0; i < sections.length; i++) {
            const { text, voice } = sections[i];
            
            // Send progress updates
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
            // Send merging start notification
            res.write(JSON.stringify({
                type: 'status',
                message: 'Merging audio files...'
            }) + '\n');

            // Create file list
            const listFile = path.join(tempDir, `list-${timestamp}.txt`);
            const fileList = audioFiles.map(f => `file '${f}'`).join('\n');
            await fs.writeFile(listFile, fileList);

            // Merge audio files
            const ffmpegPath = '/opt/homebrew/bin/ffmpeg'; // Modify if your ffmpeg location is different
            await execAsync(`"${ffmpegPath}" -f concat -safe 0 -i "${listFile}" -c copy "${outputFile}"`);

            // Clean temporary files
             // Clean up temporary files with error checking
            try {
                await Promise.all(audioFiles.map(f => fs.unlink(f)));
                await fs.unlink(listFile);
              } catch (err) {
                  console.error('Error cleaning temp files', err);
              }
  
            // Try to remove tempDir recursively
           try {
            await fs.rm(tempDir, { recursive: true });
            } catch (err) {
                 // try again, removing files first.
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
            
            // Send complete message
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

// Modify route to generate story
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


// Modify route to generate script
app.post('/generate-script', async (req, res) => {
    const { story } = req.body;
    
    // Send start message
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
        Convert this story into script format:\n${story}`

       const result = await model.generateContent(prompt);
        const response = await result.response;
        const scriptContent = response.text();

       // Send process script message
        res.write(JSON.stringify({
            type: 'status',
            message: 'Processing script format...'
        }) + '\n');

       let scriptData;
        try {
           // Try to find JSON content and extract
           const jsonMatch = scriptContent.match(/\{[\s\S]*\}/);
           if (jsonMatch) {
               scriptData = JSON.parse(jsonMatch[0]);
           } else {
               throw new Error('Invalid script format');
           }
           // Validate data format
           if (!scriptData.scenes || !Array.isArray(scriptData.scenes)) {
             throw new Error('Invalid script structure');
           }

          // Process the script content by removing all asterisks
           scriptData.scenes = scriptData.scenes.map(scene => ({
              ...scene,
              text: scene.text.replace(/\*/g, ''),
              ...(scene.character && { character: scene.character.replace(/\*/g, '') })
           }));

           // Send complete message
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

// Add podcast generating route
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

// Modify generate-image-prompt route
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

// Modify generate-image route
app.post('/generate-image', async (req, res) => {
    const { prompt, sectionId } = req.body;

    if (!prompt) {
        return res.status(400).json({
            success: false,
            error: 'Prompt is required'
        });
    }

    console.log('Searching image for prompt:', prompt);

    try {
        const pexelsApiKey = process.env.PEXELS_API_KEY;
        const pexelsUrl = `https://api.pexels.com/v1/search?query=${encodeURIComponent(prompt)}&per_page=1`;

        const response = await fetch(pexelsUrl, {
            headers: {
                'Authorization': pexelsApiKey
            }
        });

        if (!response.ok) {
            throw new Error(`Pexels API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        let imageUrl;
        if (data && data.photos && data.photos.length > 0) {
            imageUrl = data.photos[0].src.large;
        }

        if (!imageUrl) {
            console.error('No image URL found from Pexels');
            throw new Error('No image found for this prompt');
        }

        console.log('Pexels image URL:', imageUrl);

        res.json({
            success: true,
            imageUrl: imageUrl,
            sectionId: sectionId
        });
    } catch (error) {
        console.error('Error searching for image:', error);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to search image'
        });
    }
});

// Modify generate-all-images route
app.post('/generate-all-images', async (req, res) => {
    const { sections } = req.body;
    
    try {
        // Send start message
        res.write(JSON.stringify({
            type: 'status',
            message: 'Analyzing story context...'
        }) + '\n');

        // First analyze the whole story's context
        const contextPrompt = `Extract key story elements (characters, settings, themes) from the story sections. Keep it concise.\nAnalyze these story sections and extract key elements:\n${sections.map(s => s.text).join('\n\n')}`;
        
        const contextResult = await model.generateContent(contextPrompt);
        const contextResponse = await contextResult.response;
        const storyContext = contextResponse.text();
        console.log('Story context:', storyContext);

       // Send prompt generation start message
        res.write(JSON.stringify({
            type: 'status',
            message: 'Generating prompts...'
        }) + '\n');

        // Generate all prompts
        const promptResults = [];
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];

            res.write(JSON.stringify({
                type: 'prompt_progress',
                current: i + 1,
                total: sections.length,
                message: `Generating prompt ${i + 1}/${sections.length}`
            }) + '\n');

             const prompt = `You are a professional image prompt engineer. Create concise but detailed image prompts that maintain consistency across a story and are appropriate for all audiences.

            Requirements:
            1. Keep prompts under 75 words
            2. Focus on key visual elements and maintain character/setting consistency. Do not focus on emotions, or subjective descriptions.
            3. Include artistic style and mood but avoid any description that could be considered sensitive or inappropriate. Focus on descriptive terms for the visual elements, such as colors, lighting, style (e.g. realistic, cartoonish, painting etc.), and scene composition.
            4. Do not include any potentially offensive, or NSFW subject matter, or any descriptions of violence, suffering, or anything that could be considered disturbing.
            5. Use natural, descriptive language, focusing on visual elements (colors, objects, shapes, environment). Do not describe emotions, moods, or subjective impressions.
            6. Output in English only

            Story context:
            ${storyContext}
            Create an image generation prompt for this scene that is family-friendly and follows the requirements: "${section.text}"`;
         
            const promptResult = await model.generateContent(prompt);
            const promptResponse = await promptResult.response;
            
           promptResults.push({
                sectionId: section.id,
                prompt: promptResponse.text()
            });
        }

        // Send message that image generation is starting
        res.write(JSON.stringify({
            type: 'status',
            message: 'Searching images...'
        }) + '\n');

        // Search all images
        for (let i = 0; i < promptResults.length; i++) {
           const { sectionId, prompt } = promptResults[i];

            res.write(JSON.stringify({
                type: 'image_progress',
                current: i + 1,
                total: promptResults.length,
                message: `Searching image ${i + 1}/${promptResults.length}`
            }) + '\n');

           try {
                const pexelsApiKey = process.env.PEXELS_API_KEY;
                const pexelsUrl = `https://api.pexels.com/v1/search?query=${encodeURIComponent(prompt)}&per_page=1`;

                const response = await fetch(pexelsUrl, {
                    headers: {
                        'Authorization': pexelsApiKey
                    }
                });

                if (!response.ok) {
                    throw new Error(`Pexels API Error: ${response.status} ${response.statusText}`);
                }

                const data = await response.json();

                let imageUrl;
                if (data && data.photos && data.photos.length > 0) {
                    imageUrl = data.photos[0].src.large;
                }

                 if (!imageUrl) {
                     console.error('No image URL found from Pexels');
                   throw new Error('No image found for this prompt');
                }

               console.log('Pexels image URL:', imageUrl);
                
                res.write(JSON.stringify({
                  type: 'section_complete',
                   sectionId: sectionId,
                   prompt: prompt,
                   imageUrl: imageUrl,
                   current: i + 1,
                   total: promptResults.length
              }) + '\n');

            } catch (error) {
                console.error(`Error searching for image for section ${sectionId}:`, error);
                res.write(JSON.stringify({
                    type: 'section_error',
                    sectionId: sectionId,
                    error: error.message
                }) + '\n');
            }
        }

       // Send completion message
        res.write(JSON.stringify({
            type: 'complete',
            message: 'All images searched successfully'
        }));
       res.end();
        
    } catch (error) {
        res.write(JSON.stringify({
            type: 'error',
            error: error.message
        }));
        res.end();
    }
});

// Modify batch download images route
app.post('/download-images', async (req, res) => {
    const { images, theme } = req.body;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    try {
        // Ensure that output directory exists
        const outputDir = path.join(__dirname, 'output');
        await fs.mkdir(outputDir, { recursive: true });
        
        // Create directory with timestamp
        const downloadDir = path.join(outputDir, timestamp);
        await fs.mkdir(downloadDir, { recursive: true });
        
        console.log('Downloading images to:', downloadDir);
        
       // Download all images
        for (let i = 0; i < images.length; i++) {
            const { url, prompt } = images[i];
            console.log(`Downloading image ${i + 1}/${images.length} from:`, url);
            
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
                }
                
                const arrayBuffer = await response.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                
                const filename = `image-${String(i + 1).padStart(3, '0')}.webp`;
                const filePath = path.join(downloadDir, filename);
                
                await fs.writeFile(filePath, buffer);
                console.log(`Saved image to:`, filePath);

                // save prompts in a separate file
                await fs.appendFile(
                    path.join(downloadDir, 'prompts.txt'),
                    `Image ${i + 1}:\n${prompt}\nURL: ${url}\n\n`
                );
            } catch (error) {
                console.error(`Error downloading image ${i + 1}:`, error);
                await fs.appendFile(
                    path.join(downloadDir, 'errors.txt'),
                    `Failed to download image ${i + 1}:\nURL: ${url}\nError: ${error.message}\n\n`
                );
            }
        }
        
        // Create a simple HTML preview file, and adds theme information
        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>${theme || 'Story'} - Image Gallery</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
        .theme { margin-bottom: 20px; color: #666; }
        .image-container { margin-bottom: 30px; }
        img { max-width: 100%; height: auto; border-radius: 8px; }
        .prompt { margin-top: 10px; padding: 10px; background: #f5f5f5; border-radius: 4px; }
    </style>
</head>
<body>
    <h1>Generated Images</h1>
    <div class="theme">Theme: ${theme || 'Story'}</div>
    ${images.map((img, i) => `
        <div class="image-container">
            <img src="image-${String(i + 1).padStart(3, '0')}.webp" alt="Generated image ${i + 1}">
            <div class="prompt">
                <strong>Prompt ${i + 1}:</strong><br>
                ${img.prompt}
            </div>
        </div>
    `).join('')}
</body>
</html>`;

       await fs.writeFile(path.join(downloadDir, 'gallery.html'), htmlContent);

       res.json({
          success: true,
          directory: path.relative(__dirname, downloadDir),
          totalImages: images.length
        });
    } catch (error) {
        console.error('Error in download-images:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Add app.use middleware configuration
app.use((req, res, next) => {
     // Allow access only from local addresses
    const allowedOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
    const origin = req.headers.origin;
    
    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    }
    next();
});

// Add translation routes
app.post('/translate-podcast', async (req, res) => {
    const { script } = req.body;
    
    try {
        const prompt = `Translate the podcast script to Chinese. Keep the format:
        1. Keep the Host A/B labels
        2. Translate naturally and maintain the conversation style
        3. Return in this format:
        [Host A]
        Chinese translation

        [Host B]
        Chinese translation
         Translate this podcast script to Chinese:\n${script}`;
    
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const translation = response.text();
        
        res.json({ 
            success: true,
            translation: translation
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Add story script translation route
app.post('/translate-story-script', async (req, res) => {
    const { script } = req.body;
    
    try {
        const prompt = `Translate the story script to Chinese. Keep the format:
        1. Keep the [Narration] and [Dialogue] labels
        2. Translate naturally and maintain the story flow
        3. Return in this format:
        [Narration]
        Chinese translation

        [Dialogue]
        Character Name:
        Chinese translation

         Translate this story script to Chinese:\n${script}`;
    
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const translation = response.text();
        
        res.json({ 
            success: true,
            translation: translation
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});


// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});