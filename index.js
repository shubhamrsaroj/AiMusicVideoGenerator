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

  const sceneType = scenes[index] || scenes[1];
  return `${basePrompt}, ${sceneType}, ${enhancers.join(', ')}`;
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

// Function to generate music using AudioCraft
async function generateMusicFromPrompt(prompt, duration) {
  try {
    console.log('Attempting to generate music with prompt:', prompt);
    
    const response = await axios({
      method: 'post',
      url: 'http://127.0.0.1:5001/generate-music',
      data: { prompt, duration },
      responseType: 'arraybuffer',
      timeout: 600000, // Increase timeout to 10 minutes
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Save the audio file
    const outputPath = path.join(__dirname, 'temp', `music_${Date.now()}.wav`);
    await fs.writeFile(outputPath, response.data);
    console.log('Music saved to:', outputPath);
    
    return outputPath;
  } catch (error) {
    console.error('Music generation error:', error);
    throw error;
  }
}

// Update the progress tracking
let generationProgress = {
  progress: 0,
  status: '',
  videoUrl: null,
  error: null
};

async function generateVideoFrames(prompt, numFrames) {
  try {
    if (!process.env.STABILITY_API_KEY) {
      throw new Error('Missing Stability API key');
    }

    console.log('Starting frame generation:', { prompt, numFrames });
    const frames = [];
    
    for (let i = 1; i <= numFrames; i++) {
      const framePrompt = generateFramePrompt(prompt, i, numFrames);
      console.log(`Generating frame ${i}/${numFrames}`);

      try {
        const response = await axios({
          method: 'post',
          url: 'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.STABILITY_API_KEY}`,
            'Accept': 'application/json'
          },
          data: {
            text_prompts: [{ text: framePrompt, weight: 1 }],
            cfg_scale: 7,
            height: 1024,
            width: 1024,
            samples: 1,
            steps: 25
          }
        });

        if (!response.data?.artifacts?.[0]?.base64) {
          throw new Error('Invalid response from Stability API');
        }

        const framePath = path.join(__dirname, 'temp', `frame_${Date.now()}_${i}.png`);
        await fs.writeFile(framePath, Buffer.from(response.data.artifacts[0].base64, 'base64'));
        frames.push(framePath);

        // Update progress
        generationProgress.status = `Generated frame ${i}/${numFrames}`;
        generationProgress.progress = Math.round((i / numFrames) * 40);

      } catch (frameError) {
        console.error(`Error generating frame ${i}:`, frameError);
        throw new Error(`Failed to generate frame ${i}: ${frameError.message}`);
      }
    }

    return frames;
  } catch (error) {
    console.error('Frame generation failed:', error);
    generationProgress.error = error.message;
    throw error;
  }
}

// Update the createVideo function with proper fs usage
async function createVideo(frames, audioPath, duration) {
  return new Promise((resolve, reject) => {
    try {
      const outputPath = path.join(__dirname, 'videos', `video_${Date.now()}.mp4`);
      console.log('Creating video:', { frames: frames.length, audio: audioPath, output: outputPath });

      let command = ffmpeg()
        .fps(24);

      // Add each frame
      frames.forEach(frame => {
        command = command.input(frame);
      });

      // Add audio
      command = command.input(audioPath);

      command
        .complexFilter([
          {
            filter: 'concat',
            options: {
              n: frames.length,
              v: 1,
              a: 0
            },
            outputs: 'v'
          }
        ])
        .outputOptions([
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '23',
          '-c:a', 'aac',
          '-shortest',
          '-movflags', '+faststart',
          '-pix_fmt', 'yuv420p'
        ])
        .output(outputPath)
        .on('progress', progress => {
          generationProgress.status = `Encoding video: ${Math.round(progress.percent)}%`;
          generationProgress.progress = 75 + Math.round(progress.percent * 0.2);
        })
        .on('end', () => {
          console.log('Video creation completed:', outputPath);
          resolve(outputPath);
        })
        .on('error', (err) => {
          console.error('Video creation error:', err);
          reject(new Error(`Failed to create video: ${err.message}`));
        })
        .run();

    } catch (error) {
      console.error('Video creation failed:', error);
      reject(error);
    }
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

// Add a new route to get progress
app.get('/api/progress', (req, res) => {
  res.json(generationProgress);
});

// Update your video generation route
app.post('/api/generate-video', async (req, res) => {
  try {
    const { prompt, duration } = req.body;
    const durationNum = Number(duration);
    
    if (!prompt?.trim() || isNaN(durationNum)) {
      throw new Error('Invalid prompt or duration');
    }

    // Reset progress
    generationProgress = {
      progress: 0,
      status: 'Starting generation...',
      videoUrl: null,
      error: null
    };

    console.log('Starting video generation:', { prompt, duration: durationNum });

    // Generate frames
    generationProgress.status = 'Generating frames...';
    const frames = await generateVideoFrames(prompt, Math.ceil(durationNum / 2));

    // Generate music
    generationProgress.status = 'Generating music...';
    generationProgress.progress = 45;
    const audioPath = await generateMusicFromPrompt(prompt, durationNum);

    // Create video
    generationProgress.status = 'Creating final video...';
    generationProgress.progress = 75;
    const videoPath = await createVideo(frames, audioPath, durationNum);

    // Save to database
    generationProgress.status = 'Finalizing...';
    generationProgress.progress = 90;
    const videoUrl = `/videos/${path.basename(videoPath)}`;
    
    const video = new Video({
      prompt,
      videoUrl,
      duration: durationNum,
      hasAudio: true
    });
    
    await video.save();

    // Clean up
    await Promise.all([
      ...frames.map(frame => fs.unlink(frame).catch(console.error)),
      fs.unlink(audioPath).catch(console.error)
    ]);

    // Complete
    generationProgress = {
      progress: 100,
      status: 'Complete!',
      videoUrl: videoUrl,
      error: null
    };

    res.json({ success: true, videoUrl });
  } catch (error) {
    console.error('Video generation error:', error);
    generationProgress.error = error.message;
    generationProgress.status = 'Error occurred';
    generationProgress.progress = -1;
    res.status(500).json({ error: error.message });
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