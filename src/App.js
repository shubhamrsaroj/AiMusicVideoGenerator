import { useState, useEffect, useCallback } from 'react';
import { Button, CircularProgress, LinearProgress, TextField, Typography, Container, Paper, Stack, Box } from '@mui/material';
import { Alert, AlertTitle } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

const API_BASE_URL = 'http://localhost:5000';

export default function VideoGenerator() {
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(10);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentGeneration, setCurrentGeneration] = useState(null);
  const [previousGenerations, setPreviousGenerations] = useState([]);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [wordCount, setWordCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [generatedVideo, setGeneratedVideo] = useState(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [currentRequestId, setCurrentRequestId] = useState(null);

  const checkVideoStatus = useCallback(async (requestId) => {
    try {
      const progressResponse = await fetch(`http://localhost:5001/progress/${requestId}`);
      const progressData = await progressResponse.json();
      return progressData;
    } catch (error) {
      throw new Error('Error checking progress: ' + error.message);
    }
  }, []);

  useEffect(() => {
    let progressInterval;

    if (currentRequestId && loading) {
      progressInterval = setInterval(async () => {
        try {
          const progressData = await checkVideoStatus(currentRequestId);
          setProgress(progressData.progress);
          setStatus(progressData.status);

          if (progressData.progress === 100 && progressData.videoUrl) {
            setIsCompleted(true);
            setGeneratedVideo({ videoUrl: progressData.videoUrl });
            setLoading(false);
            
            const newGeneration = {
              _id: Date.now(),
              prompt,
              videoUrl: progressData.videoUrl,
              createdAt: new Date().toISOString()
            };
            
            setPreviousGenerations(prev => [newGeneration, ...prev]);
            clearInterval(progressInterval);
          } else if (progressData.progress === -1) {
            setError('Video generation failed. Please try again.');
            setLoading(false);
            clearInterval(progressInterval);
          }
        } catch (error) {
          setError(error.message);
          setLoading(false);
          clearInterval(progressInterval);
        }
      }, 1000);
    }

    return () => {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
    };
  }, [currentRequestId, loading, checkVideoStatus, prompt]);

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
    setWordCount(newPrompt.trim() ? words.length : 0);
  };

  const handleDurationChange = (event) => {
    const value = parseInt(event.target.value);
    if (!isNaN(value) && value >= 5 && value <= 30) {
      setDuration(value);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setProgress(0);
    setStatus('Starting...');
    setIsCompleted(false);
    setGeneratedVideo(null);
    setError(null);
    setCurrentRequestId(null);

    try {
      const response = await fetch('http://localhost:5000/api/generate-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, duration }),
      });

      const data = await response.json();
      
      if (data.requestId) {
        setCurrentRequestId(data.requestId);
      } else {
        throw new Error('No request ID received from server');
      }
    } catch (error) {
      console.error('Error:', error);
      setError('Failed to start video generation: ' + error.message);
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4, backgroundColor: '#111827' }}>
      <Paper elevation={3} sx={{ 
        p: 3, 
        mb: 3,
        backgroundColor: '#1f2937',
        borderRadius: 2,
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
        border: '1px solid #374151'
      }}>
        <Typography variant="h4" gutterBottom align="center" sx={{
          color: '#f3f4f6',
          fontWeight: 600
        }}>
          AI Music Video Generator
        </Typography>

        <form onSubmit={handleSubmit}>
          <Stack spacing={3}>
            <TextField
              fullWidth
              multiline
              rows={8}
              label={`Describe your video scene (${wordCount}/500 words)`}
              value={prompt}
              onChange={handlePromptChange}
              disabled={loading}
              placeholder="Please provide a description (up to 500 words)..."
              variant="outlined"
              error={wordCount > 500}
              helperText={wordCount > 500 ? 'Please keep the description under 500 words' : ''}
              sx={{
                '& .MuiOutlinedInput-root': {
                  backgroundColor: '#374151',
                  color: '#f3f4f6',
                  '& fieldset': {
                    borderColor: '#4b5563',
                  },
                  '&:hover fieldset': {
                    borderColor: '#60a5fa',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#3b82f6',
                  },
                },
                '& .MuiInputLabel-root': {
                  color: '#9ca3af',
                },
                '& .MuiInputLabel-root.Mui-focused': {
                  color: '#60a5fa',
                },
              }}
            />

            <Box sx={{ width: '100%' }}>
              <Typography gutterBottom sx={{ color: '#e5e7eb' }}>
                Duration (seconds): {duration}
              </Typography>
              <TextField
                type="number"
                value={duration}
                onChange={handleDurationChange}
                inputProps={{ min: 5, max: 30 }}
                disabled={loading}
                sx={{ 
                  width: 100,
                  '& .MuiOutlinedInput-root': {
                    backgroundColor: '#374151',
                    color: '#f3f4f6',
                    '& fieldset': {
                      borderColor: '#4b5563',
                    },
                    '&:hover fieldset': {
                      borderColor: '#60a5fa',
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: '#3b82f6',
                    },
                  }
                }}
                size="small"
              />
              <Typography variant="caption" display="block" gutterBottom sx={{ color: '#9ca3af' }}>
                Choose between 5 and 30 seconds
              </Typography>
            </Box>

            {error && (
              <Alert severity="error" sx={{ 
                backgroundColor: '#7f1d1d',
                color: '#fecaca',
                '& .MuiAlert-icon': {
                  color: '#fecaca'
                }
              }}>
                <AlertTitle>Error</AlertTitle>
                {error}
              </Alert>
            )}

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={loading || !prompt.trim() || wordCount > 500}
              sx={{ 
                py: 1.5,
                backgroundColor: '#3b82f6',
                '&:hover': {
                  backgroundColor: '#2563eb',
                },
                '&:disabled': {
                  backgroundColor: '#4b5563',
                }
              }}
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

        {loading && (
          <Box sx={{ width: '100%', mt: 2 }}>
            <LinearProgress 
              variant="determinate" 
              value={progress} 
              sx={{ 
                mb: 1,
                backgroundColor: '#374151',
                '& .MuiLinearProgress-bar': {
                  backgroundColor: '#3b82f6'
                }
              }}
            />
            <Typography variant="body2" align="center" sx={{ color: '#9ca3af' }}>
              {status} ({progress}%)
            </Typography>
          </Box>
        )}

        {isCompleted && (
          <Alert 
            severity="success" 
            icon={<CheckCircleIcon fontSize="inherit" />}
            sx={{ 
              mt: 2,
              backgroundColor: '#064e3b',
              color: '#a7f3d0',
              '& .MuiAlert-icon': {
                color: '#a7f3d0'
              }
            }}
          >
            <AlertTitle>Success</AlertTitle>
            Video generation completed successfully!
          </Alert>
        )}
      </Paper>

      {generatedVideo && (
        <Paper sx={{ 
          p: 3, 
          mb: 3,
          backgroundColor: '#1f2937',
          border: '1px solid #374151'
        }}>
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 1, 
            mb: 2 
          }}>
            <Typography variant="h6" sx={{ color: '#f3f4f6' }}>
              Generated Video
            </Typography>
            <CheckCircleIcon sx={{ color: '#34d399' }} />
          </Box>
          <Box sx={{ 
            position: 'relative', 
            paddingTop: '56.25%', 
            backgroundColor: '#000000',
            borderRadius: 1,
            overflow: 'hidden'
          }}>
            <video
              controls
              autoPlay
              key={generatedVideo.videoUrl}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                borderRadius: '4px'
              }}
              src={`${API_BASE_URL}${generatedVideo.videoUrl}`}
            />
          </Box>
        </Paper>
      )}

      {previousGenerations.length > 0 && (
        <Paper sx={{ 
          p: 3,
          backgroundColor: '#1f2937',
          border: '1px solid #374151'
        }}>
          <Typography variant="h6" gutterBottom sx={{ mb: 3, color: '#f3f4f6' }}>
            Previous Generations
          </Typography>
          <Box sx={{ 
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: '1fr 1fr',
              md: '1fr 1fr'
            },
            gap: 3
          }}>
            {previousGenerations.map((gen, index) => (
              <Paper 
                key={gen._id || index} 
                elevation={2}
                sx={{ 
                  p: 2,
                  backgroundColor: '#292f3e',
                  transition: 'all 0.2s ease-in-out',
                  '&:hover': {
                    backgroundColor: '#323a4c',
                    transform: 'translateY(-2px)'
                  }
                }}
              >
                <Box sx={{ 
                  width: '100%',
                  height: '200px',
                  position: 'relative',
                  mb: 2,
                  backgroundColor: '#000000',
                  borderRadius: 1,
                  overflow: 'hidden'
                }}>
                  <video
                    controls
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain'
                    }}
                    src={`${API_BASE_URL}${gen.videoUrl}`}
                  />
                </Box>
                <Box sx={{ p: 1 }}>
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      mb: 1,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      lineHeight: 1.4,
                      color: '#e5e7eb'
                    }}
                  >
                    {gen.prompt}
                  </Typography>
                  <Typography 
                    variant="caption"
                    sx={{ 
                      display: 'block',
                      color: '#9ca3af'
                    }}
                  >
                    {new Date(gen.createdAt).toLocaleString()}
                  </Typography>
                </Box>
              </Paper>
            ))}
          </Box>
        </Paper>
      )}
    </Container>
  );
}