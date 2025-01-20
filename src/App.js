import { useState, useEffect } from 'react';
import { Button } from "./components/ui/button.jsx";
import { Input } from "./components/ui/input.jsx";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "./components/ui/card.jsx";
import { Slider } from "./components/ui/slider.jsx";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "./components/ui/alert.jsx";
import { Box, CircularProgress } from "@mui/material";
import { TextField } from "@mui/material";
import axios from 'axios';
import { Typography } from "@mui/material";
import { Container, Paper, Stack } from '@mui/material';

// Update API base URL to match server port
const API_BASE_URL = 'http://localhost:5000'; // Match your server port

export default function VideoGenerator() {
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(15);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentGeneration, setCurrentGeneration] = useState(null);
  const [previousGenerations, setPreviousGenerations] = useState([]);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState('');
  const [audioStatus, setAudioStatus] = useState('');
  const [wordCount, setWordCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generatedVideo, setGeneratedVideo] = useState(null);

  // Fetch previous generations on component mount
  useEffect(() => {
    const fetchPreviousGenerations = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/videos`);
        if (response.ok) {
          const data = await response.json();
          setPreviousGenerations(data);
        }
      } catch (error) {
        console.error('Failed to fetch previous generations:', error);
      }
    };

    fetchPreviousGenerations();
  }, []);

  const handlePromptChange = (e) => {
    const newPrompt = e.target.value;
    setPrompt(newPrompt);
    const words = newPrompt.trim().split(/\s+/);
    setWordCount(newPrompt.trim() ? words.length : 0); // Don't count if empty
  };

  const handleDurationChange = (event) => {
    const value = parseInt(event.target.value);
    if (!isNaN(value) && value >= 5 && value <= 30) {
      setDuration(value);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) {
      return;
    }

    setLoading(true);
    setError(null);
    setGeneratedVideo(null);

    try {
      const response = await axios.post('http://localhost:5000/api/generate-video', {
        prompt,
        duration: Number(duration)
      });

      setGeneratedVideo(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate video');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h4" gutterBottom align="center">
          AI Video Generator
        </Typography>

        <form onSubmit={handleSubmit}>
          <Stack spacing={3}>
            <TextField
              fullWidth
              multiline
              rows={8}
              label={`Describe your video scene (${wordCount}/150 words)`}
              value={prompt}
              onChange={handlePromptChange}
              disabled={loading}
              placeholder="Please provide a description (up to 150 words)..."
              variant="outlined"
              error={wordCount > 150}
              helperText={wordCount > 150 ? 
                'Please keep the description under 150 words' : 
                ''}
            />

            <Box sx={{ width: '100%' }}>
              <Typography gutterBottom>
                Duration (seconds): {duration}
              </Typography>
              <Input
                type="number"
                value={duration}
                onChange={handleDurationChange}
                inputProps={{
                  min: 5,
                  max: 30,
                  step: 1
                }}
                disabled={loading}
                sx={{ width: 100 }}
              />
              <Typography variant="caption" display="block" gutterBottom>
                Choose between 5 and 30 seconds
              </Typography>
            </Box>

            {error && (
              <Alert severity="error">
                {error}
              </Alert>
            )}

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={loading || !prompt.trim()}
              onClick={handleSubmit}
              sx={{ py: 1.5 }}
            >
              {loading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <CircularProgress size={24} color="inherit" />
                  <span>Generating...</span>
                </Box>
              ) : (
                'Generate Video'
              )}
            </Button>
          </Stack>
        </form>
      </Paper>

      {generatedVideo && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Generated Video
            </Typography>
            <Box sx={{ position: 'relative', paddingTop: '56.25%', mb: 2 }}>
              <video
                controls
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  borderRadius: '4px'
                }}
                src={`http://localhost:5000${generatedVideo.videoUrl}`}
              />
            </Box>
          </CardContent>
        </Card>
      )}

      {previousGenerations.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">Previous Generations</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {previousGenerations.map((gen, index) => (
              <Card key={gen._id || index} className="bg-slate-800 border-slate-700">
                <CardContent className="p-4">
                  <video
                    controls
                    className="w-full h-48 object-cover rounded-lg mb-2 bg-slate-900"
                    src={`${API_BASE_URL}${gen.videoUrl}`}
                  />
                  <p className="text-sm text-slate-400 truncate">{gen.prompt}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(gen.createdAt).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </Container>
  );
}