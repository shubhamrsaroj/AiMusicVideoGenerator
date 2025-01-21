import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import axios from 'axios';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

// Verify required API keys
if (!process.env.FREE_SOUND_API_KEY || !process.env.STABILITY_API_KEY) {
  console.error('Missing required API keys in environment variables');
  process.exit(1);
}

const app = express();
app.use(cors({
  origin: 'http://localhost:3000', // React default port
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());
app.use('/videos', (req, res, next) => {
  res.header('Content-Type', 'video/mp4');
  res.header('Accept-Ranges', 'bytes');
  next();
}, express.static(path.join(__dirname, 'videos')));

// MongoDB setup
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/soundapi-app')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

const videoSchema = new mongoose.Schema({
  prompt: String,
  videoUrl: String,
  duration: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
  hasAudio: Boolean
});

const Video = mongoose.model('Video', videoSchema);

// Set FFmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Add these constants at the top of your file
const DEFAULT_CATEGORIES = [
  'ambient music',
  'background music',
  'soundtrack',
  'atmospheric music',
  'instrumental'
];

// Ensure directories exist
['temp', 'videos'].forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
});

// Function to generate better prompts for each frame
function generateFramePrompt(basePrompt, index, totalFrames) {
  const scenes = {
    1: 'wide establishing shot, cinematic landscape',
    2: 'medium shot, focusing on main subject',
    3: 'close-up shot, showing details',
    4: 'action shot, dynamic movement',
    5: 'dramatic finale shot'
  };

  const enhancers = [
    'cinematic lighting',
    'professional photography',
    'high detail',
    '8k resolution',
    'masterful composition'
  ];

  return `${basePrompt}, ${scenes[index] || scenes[1]}, ${enhancers.join(', ')}`;
}

// Function to extract keywords from prompt
function extractKeywords(prompt) {
  // Remove common words and split into keywords
  const commonWords = ['a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with', 'by'];
  const words = prompt.toLowerCase().split(/\W+/);
  const keywords = words.filter(word => 
    word.length > 2 && !commonWords.includes(word)
  );
  return keywords;
}

// Default sound categories for fallback
const defaultSounds = [
  'ambient',
  'background music',
  'melody',
  'atmospheric',
  'soundtrack'
];

// Add this function to handle Freesound API search and download
async function searchAndDownloadMusic(prompt, outputPath) {
  try {
    console.log('Searching with full prompt:', prompt);
    
    // First try with full prompt
    let searchResponse = await axios.get('https://freesound.org/apiv2/search/text/', {
      params: {
        query: prompt,
        token: process.env.FREE_SOUND_API_KEY,
        fields: 'id,name,previews',
        filter: 'duration:[1 TO 30]',
        sort: 'rating_desc',
        page_size: 1
      }
    });

    // If no results, try with keywords
    if (!searchResponse.data.results || searchResponse.data.results.length === 0) {
      const keywords = extractKeywords(prompt);
      console.log('No results found. Trying with keywords:', keywords);

      for (const keyword of keywords) {
        searchResponse = await axios.get('https://freesound.org/apiv2/search/text/', {
          params: {
            query: `${keyword} music background`,
            token: process.env.FREE_SOUND_API_KEY,
            fields: 'id,name,previews',
            filter: 'duration:[1 TO 30]',
            sort: 'rating_desc',
            page_size: 1
          }
        });

        if (searchResponse.data.results && searchResponse.data.results.length > 0) {
          break;
        }
      }
    }

    // If still no results, use DEFAULT_CATEGORIES
    if (!searchResponse.data.results || searchResponse.data.results.length === 0) {
      console.log('No results with keywords. Trying default categories:', DEFAULT_CATEGORIES);
      
      for (const category of DEFAULT_CATEGORIES) {
        searchResponse = await axios.get('https://freesound.org/apiv2/search/text/', {
          params: {
            query: category,
            token: process.env.FREE_SOUND_API_KEY,
            fields: 'id,name,previews',
            filter: 'duration:[1 TO 30]',
            sort: 'rating_desc',
            page_size: 1
          }
        });

        if (searchResponse.data.results && searchResponse.data.results.length > 0) {
          console.log('Found matching default category:', category);
          break;
        }
      }
    }

    if (!searchResponse.data.results || searchResponse.data.results.length === 0) {
      throw new Error('No matching sounds found after all attempts');
    }

    const sound = searchResponse.data.results[0];
    console.log('Selected sound:', sound.name);

    // Download the preview audio file
    const downloadUrl = sound.previews['preview-hq-mp3'];
    const audioResponse = await axios({
      method: 'GET',
      url: downloadUrl,
      responseType: 'arraybuffer'
    });

    // Write the file
    await fs.writeFile(outputPath, Buffer.from(audioResponse.data));
    console.log(`Successfully downloaded music to ${outputPath}`);

    return {
      success: true,
      musicPath: outputPath,
      soundName: sound.name,
      searchMethod: prompt === searchResponse.config.params.query ? 'direct' : 
                   DEFAULT_CATEGORIES.includes(searchResponse.config.params.query) ? 'default' : 
                   'keyword'
    };

  } catch (error) {
    console.error('Error in searchAndDownloadMusic:', error);
    throw error;
  }
}

// Function to generate frames using Stability API
async function generateVideoFrames(prompt, numFrames) {
  try {
    const frames = [];
    const minFrames = Math.max(4, numFrames); // Ensure at least 4 frames
    
    // Create temp directory if it doesn't exist
    const tempDir = path.join(__dirname, 'temp');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    for (let i = 0; i < minFrames; i++) {
      const framePrompt = `${prompt}, scene ${i + 1}, cinematic quality, high detail`;
      console.log(`Generating frame ${i + 1}/${minFrames} with prompt: ${framePrompt}`);

      const response = await axios({
        method: 'post',
        url: 'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
        headers: {
          'Authorization': `Bearer ${process.env.STABILITY_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        data: {
          text_prompts: [{ 
            text: framePrompt,
            weight: 1 
          }],
          cfg_scale: 7,
          height: 1024,
          width: 1024,
          samples: 1,
          steps: 30,
          seed: Math.floor(Math.random() * 1000000) + i // Different seed for each frame
        }
      });

      if (response.data?.artifacts?.[0]?.base64) {
        const imagePath = path.join(tempDir, `frame_${i}.png`);
        await fs.writeFile(imagePath, Buffer.from(response.data.artifacts[0].base64, 'base64'));
        frames.push(imagePath);
        console.log(`Successfully generated frame ${i + 1}`);
        
        // Add delay between API calls
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (frames.length === 0) {
      throw new Error('Failed to generate any frames');
    }

    return frames;
  } catch (error) {
    console.error('Error generating frames:', error);
    throw error;
  }
}

// Update the createVideo function with proper fs usage
async function createVideo(frames, audioPath, duration) {
  const outputPath = path.join(__dirname, 'videos', `${Date.now()}.mp4`);
  
  return new Promise((resolve, reject) => {
    let command = ffmpeg();
    
    // Add each frame with duration
    frames.forEach((frame, index) => {
      command = command
        .input(frame)
        .inputOptions([
          '-loop', '1',
          '-t', String(Math.ceil(duration / frames.length))
        ]);
    });

    // Add audio
    if (audioPath) {
      command = command.input(audioPath);
    }

    // Create filter complex
    const inputs = frames.map((_, i) => `[${i}:v]scale=1024:1024,setdar=1:1,format=yuv420p[v${i}];`).join('');
    const concatInputs = frames.map((_, i) => `[v${i}]`).join('');
    const filter = `${inputs}${concatInputs}concat=n=${frames.length}:v=1:a=0[outv]`;
    
    // Add audio filter if available
    const audioFilter = audioPath ? `;[${frames.length}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[outa]` : '';

    command
      .complexFilter(filter + audioFilter)
      .outputOptions([
        '-map', '[outv]',
        ...(audioPath ? ['-map', '[outa]'] : []),
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-movflags', '+faststart',
        '-pix_fmt', 'yuv420p',
        '-r', '24'
      ])
      .output(outputPath)
      .on('start', commandLine => {
        console.log('FFmpeg started:', commandLine);
      })
      .on('progress', progress => {
        console.log('Processing:', progress.percent, '% done');
      })
      .on('end', async () => {
        try {
          // Use async fs.stat instead of sync version
          const stats = await fs.stat(outputPath);
          if (stats.size > 0) {
            console.log('Video created successfully:', outputPath);
            resolve(outputPath);
          } else {
            reject(new Error('Video file is empty'));
          }
        } catch (error) {
          reject(new Error('Failed to verify video file: ' + error.message));
        }
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        reject(err);
      })
      .run();
  });
}

// Helper function to ensure directories exist
function ensureDirectoriesExist() {
  const dirs = ['temp', 'videos'].map(dir => path.join(__dirname, dir));
  dirs.forEach(dir => {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  });
}

// Helper function to verify file exists and has content
async function verifyFile(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.size > 0;
  } catch (error) {
    return false;
  }
}

// Update the getAudioFromFreesound function
async function getAudioFromFreesound(prompt, duration) {
  try {
    // Extract keywords from prompt
    const keywords = prompt.toLowerCase()
      .split(/[\s.,!?]+/)
      .filter(word => word.length > 3)
      .filter(word => !['with', 'and', 'the', 'for'].includes(word));
    
    console.log('Searching with keywords:', keywords);

    // Try with keywords first
    for (const keyword of keywords) {
      const searchResponse = await axios.get('https://freesound.org/apiv2/search/text/', {
        params: {
          query: `${keyword} music background`,
          token: process.env.FREE_SOUND_API_KEY,
          fields: 'id,name,previews,duration',
          filter: `duration:[${duration-5} TO ${duration+5}]`,
          sort: 'rating_desc',
          page_size: 1
        }
      });

      if (searchResponse.data?.results?.[0]) {
        const sound = searchResponse.data.results[0];
        console.log(`Found sound for keyword "${keyword}":`, sound.name);
        
        const audioResponse = await axios({
          method: 'get',
          url: sound.previews['preview-hq-mp3'],
          responseType: 'arraybuffer'
        });

        const audioPath = path.join(__dirname, 'temp', `audio_${Date.now()}.mp3`);
        await fs.writeFile(audioPath, Buffer.from(audioResponse.data));
        return audioPath;
      }
    }

    // If no results with keywords, use default categories
    console.log('No results with keywords, trying default categories...');
    for (const category of DEFAULT_CATEGORIES) {
      const searchResponse = await axios.get('https://freesound.org/apiv2/search/text/', {
        params: {
          query: category,
          token: process.env.FREE_SOUND_API_KEY,
          fields: 'id,name,previews,duration',
          filter: `duration:[${duration-5} TO ${duration+5}]`,
          sort: 'rating_desc',
          page_size: 1
        }
      });

      if (searchResponse.data?.results?.[0]) {
        const sound = searchResponse.data.results[0];
        console.log(`Found default sound from category "${category}":`, sound.name);
        
        const audioResponse = await axios({
          method: 'get',
          url: sound.previews['preview-hq-mp3'],
          responseType: 'arraybuffer'
        });

        const audioPath = path.join(__dirname, 'temp', `audio_${Date.now()}.mp3`);
        await fs.writeFile(audioPath, Buffer.from(audioResponse.data));
        return audioPath;
      }
    }

    throw new Error('No suitable audio found');
  } catch (error) {
    console.error('Error getting audio:', error);
    return null;
  }
}

// Update the route handler
app.post('/api/generate-video', async (req, res) => {
  try {
    const { prompt, duration } = req.body;
    const durationNum = Number(duration);
    
    if (!prompt?.trim() || isNaN(durationNum)) {
      return res.status(400).json({ error: 'Invalid prompt or duration' });
    }

    console.log('Starting video generation...');
    
    // Generate frames first
    const frames = await generateVideoFrames(prompt, Math.ceil(durationNum / 2));
    if (!frames || frames.length === 0) {
      throw new Error('Failed to generate frames');
    }

    // Get audio
    const audioPath = await getAudioFromFreesound(prompt, durationNum);
    if (!audioPath) {
      throw new Error('Failed to get audio');
    }

    // Create video
    const videoPath = await createVideo(frames, audioPath, durationNum);
    
    // Verify video file
    const stats = await fs.stat(videoPath);
    if (stats.size === 0) {
      throw new Error('Generated video file is empty');
    }

    const videoUrl = `/videos/${path.basename(videoPath)}`;
    
    // Save to database
    const video = new Video({
      prompt,
      videoUrl,
      duration: durationNum,
      hasAudio: true
    });
    
    await video.save();

    // Clean up temp files
    await Promise.all([
      ...frames.map(frame => fs.unlink(frame).catch(console.error)),
      fs.unlink(audioPath).catch(console.error)
    ]);

    res.json({
      success: true,
      video: {
        ...video.toObject(),
        fullUrl: `http://localhost:5000${videoUrl}`
      }
    });
  } catch (error) {
    console.error('Video generation error:', error);
    res.status(500).json({ error: error.message || 'Video generation failed' });
  }
});

// Get previous generations
app.get('/api/videos', async (req, res) => {
  try {
    const videos = await Video.find()
      .sort({ createdAt: -1 })
      .limit(10);
    res.json(videos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Handle errors
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something broke!' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Freesound API configuration
const FREESOUND_API_KEY = process.env.FREE_SOUND_API_KEY;
const FREESOUND_CLIENT_ID = process.env.FREESOUND_CLIENT_ID;

async function downloadAudio(url, outputPath) {
  const response = await axios({
    method: 'GET',
    url: url,
    responseType: 'stream'
  });

  const writer = fs.createWriteStream(outputPath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}