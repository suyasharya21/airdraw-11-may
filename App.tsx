
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Settings, GestureState, Point, Stroke } from './types';
import { detectGesture } from './utils/handLogic';
import ControlPanel from './components/ControlPanel';

// Load MediaPipe from CDN
declare var Hands: any;
declare var Camera: any;

const App: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null); 
  const drawRef = useRef<HTMLCanvasElement>(null);   
  const [settings, setSettings] = useState<Settings>({
    markerColor: '#2563eb',
    brushSize: 8,
    eraserSize: 60,
    opacity: 1.0,
    whiteboardBackground: false,
  });
  const [gesture, setGesture] = useState<GestureState>(GestureState.IDLE);
  const [fps, setFps] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showSavedToast, setShowSavedToast] = useState(false);

  // Stroke-based state
  const strokesRef = useRef<Stroke[]>([]);
  const currentStrokesRef = useRef<{ [key: string]: Stroke | null }>({ Left: null, Right: null });
  const draggingStrokeId = useRef<{ [key: string]: string | null }>({ Left: null, Right: null });
  const lastDragEndTimeRef = useRef<number>(0);

  // Undo / Redo History
  const historyRef = useRef<Stroke[][]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  // Per-hand state tracking for smooth, multi-hand drawing
  const prevPoints = useRef<{ [key: string]: Point | null }>({ Left: null, Right: null });
  const lastMidPoints = useRef<{ [key: string]: Point | null }>({ Left: null, Right: null });
  const smoothedPoints = useRef<{ [key: string]: Point | null }>({ Left: null, Right: null });
  const isCurrentlyDrawing = useRef<{ [key: string]: boolean }>({ Left: false, Right: false });
  const lastDrawingTimeRef = useRef<number>(0);
  
  const lastScreenshotTimeRef = useRef<number>(0);
  const screenshotStartTimeRef = useRef<number>(0);
  
  const lastTimeRef = useRef<number>(performance.now());
  const framesRef = useRef<number>(0);

  // EMA smoothing factor (0 to 1). Higher is more responsive (less lag), lower is smoother.
  const SMOOTHING_FACTOR = 0.98;

  // Persistence for continuous drawing (grace period of frames)
  const DRAWING_PERSISTENCE_THRESHOLD = 3;
  const drawingPersistenceRef = useRef<{ [key: string]: number }>({ Left: 0, Right: 0 });

  const saveToHistory = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    }
    
    // Deep copy strokes for history
    const strokesCopy = strokesRef.current.map(s => ({ ...s, points: [...s.points] }));
    historyRef.current.push(strokesCopy);
    
    if (historyRef.current.length > 30) {
      historyRef.current.shift();
    } else {
      historyIndexRef.current++;
    }

    setHistoryState({
      canUndo: historyIndexRef.current > 0,
      canRedo: false
    });
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
      strokesRef.current = historyRef.current[historyIndexRef.current].map(s => ({ ...s, points: [...s.points] }));
      setHistoryState({
        canUndo: historyIndexRef.current > 0,
        canRedo: historyIndexRef.current < historyRef.current.length - 1
      });
      renderAllStrokes();
    }
  }, []);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++;
      strokesRef.current = historyRef.current[historyIndexRef.current].map(s => ({ ...s, points: [...s.points] }));
      setHistoryState({
        canUndo: true,
        canRedo: historyIndexRef.current < historyRef.current.length - 1
      });
      renderAllStrokes();
    }
  }, []);

  const renderAllStrokes = useCallback(() => {
    const canvas = drawRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Render completed strokes
    strokesRef.current.forEach(stroke => {
      drawStroke(ctx, stroke);
    });

    // Render active strokes
    Object.values(currentStrokesRef.current).forEach((stroke: Stroke | null) => {
      if (stroke) drawStroke(ctx, stroke);
    });
  }, []);

  const drawStroke = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    if (stroke.points.length < 2) return;
    
    ctx.beginPath();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.globalAlpha = stroke.opacity;
    
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    
    // Use quadratic curves for smoothing
    for (let i = 1; i < stroke.points.length - 1; i++) {
        const xc = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
        const yc = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
        ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, xc, yc);
    }
    
    // Draw the last bit
    if (stroke.points.length > 1) {
        ctx.lineTo(stroke.points[stroke.points.length - 1].x, stroke.points[stroke.points.length - 1].y);
    }

    ctx.stroke();
    ctx.globalAlpha = 1.0;
  };

  const clearBoard = useCallback(() => {
    strokesRef.current = [];
    saveToHistory();
    renderAllStrokes();
  }, [saveToHistory, renderAllStrokes]);

  const triggerScreenshot = useCallback(() => {
    const now = Date.now();
    if (now - lastScreenshotTimeRef.current < 10000) return; // 10s cooldown
    lastScreenshotTimeRef.current = now;

    const video = videoRef.current;
    const drawCanvas = drawRef.current;
    if (!video || !drawCanvas) return;

    // AUDIO FEEDBACK: Synthesized camera shutter sound
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.1);
      
      gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.1);
    } catch (e) {
      console.log('Audio feedback failed', e);
    }

    // Flash & Shutter effect
    setIsCapturing(true);
    setTimeout(() => setIsCapturing(false), 500);
    setTimeout(() => {
      setShowSavedToast(true);
      setTimeout(() => setShowSavedToast(false), 3000);
    }, 400);

    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = drawCanvas.width;
    captureCanvas.height = drawCanvas.height;
    const ctx = captureCanvas.getContext('2d');
    if (!ctx) return;

    // The UI handles mirroring via CSS, so we need to replicate that
    ctx.translate(captureCanvas.width, 0);
    ctx.scale(-1, 1);

    // Capture current frame and board
    ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
    ctx.drawImage(drawCanvas, 0, 0);

    // Automatic download logic
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const rand = Math.floor(Math.random() * 1000);
    link.download = `whiteboard-capture-${timestamp}-${rand}.png`;
    link.href = captureCanvas.toDataURL('image/png', 1.0);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // PrintScreen usually isn't capturable in many browsers, so we add Alt+S / Cmd+S as well
      if (e.key === 'PrintScreen' || (e.altKey && e.key === 's')) {
        e.preventDefault();
        triggerScreenshot();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [triggerScreenshot]);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [initRetry, setInitRetry] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const drawCanvas = drawRef.current;
    if (!video || !canvas || !drawCanvas) return;

    const ctx = canvas.getContext('2d');
    const dctx = drawCanvas.getContext('2d');
    if (!ctx || !dctx) return;

    // Use a ref to track initialization state to avoid multiple setups
    let handsInstance: any = null;
    let cameraInstance: any = null;
    let isDestroyed = false;

    // Load External Scripts for MediaPipe with verification
    const loadScript = (src: string, globalName: string): Promise<void> => {
      return new Promise((resolve, reject) => {
        if ((window as any)[globalName]) {
          resolve();
          return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.crossOrigin = "anonymous";
        
        const timeout = setTimeout(() => {
          reject(new Error(`Timeout loading ${globalName} from ${src}`));
        }, 10000);

        script.onload = () => {
          clearTimeout(timeout);
          // Wait a tiny bit for the global to be attached
          const checkGlobal = setInterval(() => {
            if ((window as any)[globalName]) {
              clearInterval(checkGlobal);
              resolve();
            }
          }, 50);
          
          // Max check 2 seconds
          setTimeout(() => {
            clearInterval(checkGlobal);
            if (!(window as any)[globalName]) {
               reject(new Error(`${globalName} failed to initialize from script`));
            }
          }, 2000);
        };

        script.onerror = () => {
          clearTimeout(timeout);
          reject(new Error(`Failed to load script: ${src}`));
        };

        document.head.appendChild(script);
      });
    };

    const runInit = async () => {
      try {
        // Explicitly check for camera permission first to handle errors better
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          stream.getTracks().forEach(track => track.stop());
        } catch (err: any) {
          if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || err.message.includes('denied')) {
            throw new Error("CAMERA_PERMISSION_DENIED");
          }
          throw err;
        }

        await Promise.all([
          loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js", "Hands"),
          loadScript("https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js", "Camera")
        ]);

        if (isDestroyed) return;

        const onResults = (results: any) => {
          if (isDestroyed) return;
          // FPS Calculation
          framesRef.current++;
          const now = performance.now();
          if (now - lastTimeRef.current > 1000) {
            setFps(Math.round((framesRef.current * 1000) / (now - lastTimeRef.current)));
            framesRef.current = 0;
            lastTimeRef.current = now;
          }

          // Sync canvas dimensions and initial history save
          if (canvas.width !== video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            drawCanvas.width = video.videoWidth;
            drawCanvas.height = video.videoHeight;
            
            if (historyRef.current.length === 0) {
              saveToHistory();
            }
          }

          renderAllStrokes();

          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const activeHandLabels = new Set<string>();
          const currentHandGestures: {[key: string]: GestureState} = {};

          if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            results.multiHandLandmarks.forEach((landmarks: any, index: number) => {
              const handedness = results.multiHandedness[index];
              const label = handedness.label;
              activeHandLabels.add(label);

              let state = detectGesture(landmarks);
              
              // Apply persistence to Marker state to prevent flickering breaks
              if (state === GestureState.MARKER) {
                drawingPersistenceRef.current[label] = DRAWING_PERSISTENCE_THRESHOLD;
              } else if (state === GestureState.IDLE && drawingPersistenceRef.current[label] > 0) {
                state = GestureState.MARKER;
                drawingPersistenceRef.current[label]--;
              } else {
                drawingPersistenceRef.current[label] = 0;
              }

              const isDrawing = state === GestureState.MARKER || state === GestureState.ERASER;
              const wasDrawing = isCurrentlyDrawing.current[label];
              
              // Latency: prevent DRAG or SCREENSHOT if drawing just occurred or is occurring
              const nowMs = Date.now();
              const isCoolDown = nowMs - lastDrawingTimeRef.current < 1000;
              const isOtherHandDrawing = Object.entries(isCurrentlyDrawing.current).some(([k, v]) => k !== label && v);

              if (state === GestureState.DRAG || state === GestureState.SCREENSHOT) {
                if (isDrawing || isOtherHandDrawing || isCoolDown) {
                  state = GestureState.IDLE;
                }
              }

              currentHandGestures[label] = state;
              
              if (state !== GestureState.IDLE) {
                setGesture(state);
              }
              
              if (wasDrawing && !isDrawing) {
                // Stroke finished
                const activeStroke = currentStrokesRef.current[label];
                if (activeStroke && activeStroke.points.length > 1) {
                  strokesRef.current.push(activeStroke);
                }
                currentStrokesRef.current[label] = null;
                saveToHistory();
                lastDrawingTimeRef.current = Date.now();
              }
              
              const isActivelyDrawing = state === GestureState.MARKER || state === GestureState.ERASER;
              isCurrentlyDrawing.current[label] = isActivelyDrawing;
              
              const indexTip = landmarks[8];
              const palm = landmarks[9];
              
              let rawX = indexTip.x * canvas.width;
              let rawY = indexTip.y * canvas.height;

              if (state === GestureState.ERASER) {
                rawX = palm.x * canvas.width;
                rawY = palm.y * canvas.height;
              }

              let smoothed = smoothedPoints.current[label];
              if (!smoothed) {
                smoothed = { x: rawX, y: rawY };
              } else {
                smoothed.x = smoothed.x + (rawX - smoothed.x) * SMOOTHING_FACTOR;
                smoothed.y = smoothed.y + (rawY - smoothed.y) * SMOOTHING_FACTOR;
              }
              smoothedPoints.current[label] = smoothed;

              const currentPoint = { ...smoothed };
              
              if (state === GestureState.MARKER) {
                if (!wasDrawing || !currentStrokesRef.current[label]) {
                  // Start new stroke
                  currentStrokesRef.current[label] = {
                    id: Math.random().toString(36).substr(2, 9),
                    points: [currentPoint],
                    color: settingsRef.current.markerColor,
                    size: settingsRef.current.brushSize,
                    opacity: settingsRef.current.opacity
                  };
                } else {
                  // Continue current stroke
                  currentStrokesRef.current[label]!.points.push(currentPoint);
                }
                prevPoints.current[label] = currentPoint;
              } else if (state === GestureState.DRAG) {
                const dragId = draggingStrokeId.current[label];
                const prevHandPos = prevPoints.current[label];

                if (!dragId) {
                  // Find closest stroke to grab
                  let closestId = null;
                  let minDistance = 50; // Grab radius

                  strokesRef.current.forEach(stroke => {
                    stroke.points.forEach(p => {
                      const dist = Math.sqrt(Math.pow(p.x - currentPoint.x, 2) + Math.pow(p.y - currentPoint.y, 2));
                      if (dist < minDistance) {
                        minDistance = dist;
                        closestId = stroke.id;
                      }
                    });
                  });

                  if (closestId) {
                    draggingStrokeId.current[label] = closestId;
                  }
                } else {
                  // Move the grabbed stroke
                  const strokeIndex = strokesRef.current.findIndex(s => s.id === dragId);
                  if (strokeIndex !== -1 && prevHandPos) {
                    const dx = currentPoint.x - prevHandPos.x;
                    const dy = currentPoint.y - prevHandPos.y;
                    
                    strokesRef.current[strokeIndex].points = strokesRef.current[strokeIndex].points.map(p => ({
                      x: p.x + dx,
                      y: p.y + dy
                    }));
                    
                    // Visual feedback for dragging
                    ctx.strokeStyle = '#3b82f6';
                    ctx.lineWidth = 2;
                    ctx.setLineDash([5, 5]);
                    const s = strokesRef.current[strokeIndex];
                    if (s.points.length > 0) {
                      const minX = Math.min(...s.points.map(p => p.x));
                      const maxX = Math.max(...s.points.map(p => p.x));
                      const minY = Math.min(...s.points.map(p => p.y));
                      const maxY = Math.max(...s.points.map(p => p.y));
                      ctx.strokeRect(minX - 5, minY - 5, (maxX - minX) + 10, (maxY - minY) + 10);
                    }
                    ctx.setLineDash([]);
                  }
                }
                prevPoints.current[label] = currentPoint;
              } else if (state === GestureState.ERASER) {
                const now = Date.now();
                if (now - lastDragEndTimeRef.current < 200) {
                  // Cool down: prevent erasing right after dropping something
                  state = GestureState.IDLE;
                  currentHandGestures[label] = GestureState.IDLE;
                } else {
                  const currentSettings = settingsRef.current;
                  const eRadius = currentSettings.eraserSize / 2;
                  
                  const newStrokes: Stroke[] = [];
                  let modified = false;

                  strokesRef.current.forEach(stroke => {
                    let currentNewStrokePoints: Point[] = [];
                    let strokeSplit = false;

                    stroke.points.forEach(p => {
                      const dist = Math.sqrt(Math.pow(p.x - currentPoint.x, 2) + Math.pow(p.y - currentPoint.y, 2));
                      if (dist < eRadius) {
                        if (currentNewStrokePoints.length > 1) {
                          newStrokes.push({ 
                            ...stroke, 
                            id: Math.random().toString(36).substr(2, 9), 
                            points: currentNewStrokePoints 
                          });
                        }
                        currentNewStrokePoints = [];
                        strokeSplit = true;
                        modified = true;
                      } else {
                        currentNewStrokePoints.push(p);
                      }
                    });

                    if (currentNewStrokePoints.length > 1) {
                      if (!strokeSplit) {
                        newStrokes.push(stroke);
                      } else {
                        newStrokes.push({ 
                          ...stroke, 
                          id: Math.random().toString(36).substr(2, 9), 
                          points: currentNewStrokePoints 
                        });
                      }
                    }
                  });
                  
                  if (modified) {
                    strokesRef.current = newStrokes;
                  }
                }
                prevPoints.current[label] = null;
              } else {
                if (draggingStrokeId.current[label]) {
                  lastDragEndTimeRef.current = Date.now();
                }
                prevPoints.current[label] = null;
                draggingStrokeId.current[label] = null;
              }
              
              // Feedback indicators (dot structure)
              if (state === GestureState.ERASER) {
                const currentSettings = settingsRef.current;
                const eWidth = currentSettings.eraserSize * 0.7;
                const eHeight = currentSettings.eraserSize * 1.2;
                
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
                ctx.lineWidth = 3;
                ctx.strokeRect(currentPoint.x - eWidth / 2, currentPoint.y - eHeight / 2, eWidth, eHeight);
                
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(currentPoint.x - eWidth / 2, currentPoint.y - eHeight / 2, eWidth, eHeight);
                
                ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
                ctx.fillRect(currentPoint.x - eWidth / 2, currentPoint.y - eHeight / 2, eWidth, eHeight);
              } else {
                const currentSettings = settingsRef.current;
                ctx.beginPath();
                ctx.arc(currentPoint.x, currentPoint.y, state === GestureState.IDLE ? 6 : currentSettings.brushSize, 0, Math.PI * 2);
                
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
                ctx.lineWidth = 3;
                ctx.stroke();

                ctx.strokeStyle = 'white';
                ctx.lineWidth = 1.2;
                ctx.stroke();
                
                ctx.fillStyle = state === GestureState.MARKER ? currentSettings.markerColor : 'rgba(255, 255, 255, 0.3)';
                ctx.globalAlpha = state === GestureState.MARKER ? currentSettings.opacity : 1.0;
                ctx.fill();
                ctx.globalAlpha = 1.0;
                
                ctx.fillStyle = settingsRef.current.whiteboardBackground ? '#4b5563' : 'white';
                ctx.font = 'bold 10px sans-serif';
                ctx.textAlign = 'center';
                if (state !== GestureState.IDLE) {
                    ctx.fillText(state, currentPoint.x, currentPoint.y - 20);
                }
              }
            });
          }

          ['Left', 'Right'].forEach(side => {
            const activeState = currentHandGestures[side];

            if (!activeHandLabels.has(side)) {
              if (isCurrentlyDrawing.current[side]) {
                const activeStroke = currentStrokesRef.current[side];
                if (activeStroke && activeStroke.points.length > 1) {
                  strokesRef.current.push(activeStroke);
                }
                currentStrokesRef.current[side] = null;
                saveToHistory();
                isCurrentlyDrawing.current[side] = false;
              }
              prevPoints.current[side] = null;
              lastMidPoints.current[side] = null;
              smoothedPoints.current[side] = null;
              draggingStrokeId.current[side] = null;
            }
          });

          if (activeHandLabels.size === 0) {
            setGesture(GestureState.IDLE);
          }

          // Trigger Screenshot Action with 10s cooldown and 1/3s stability
          const nowMs = Date.now();
          const hasScreenshotGesture = Object.values(currentHandGestures).some(s => s === GestureState.SCREENSHOT);

          if (hasScreenshotGesture) {
            if (screenshotStartTimeRef.current === 0) {
              screenshotStartTimeRef.current = nowMs;
            } else if (nowMs - screenshotStartTimeRef.current > 333) {
              // Stability reached (held for 1/3s)
              // Note: triggerScreenshot has its own 10s cooldown check
              triggerScreenshot();
              // Reset start time so it doesn't trigger again immediately in the next frame
              // even if 10s haven't passed (triggerScreenshot will block it, but we should reset anyway)
              screenshotStartTimeRef.current = nowMs + 10000; 
            }
          } else {
            screenshotStartTimeRef.current = 0;
          }
        };

        const HandsClass = (window as any).Hands;
        const CameraClass = (window as any).Camera;

        if (!HandsClass || !CameraClass) {
          throw new Error("MediaPipe components (Hands/Camera) not found on window object.");
        }

        handsInstance = new HandsClass({
          locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        handsInstance.setOptions({
          maxNumHands: 2,
          modelComplexity: 1,
          minDetectionConfidence: 0.7,
          minTrackingConfidence: 0.7
        });

        handsInstance.onResults(onResults);

        cameraInstance = new CameraClass(video, {
          onFrame: async () => {
            if (!isDestroyed && handsInstance) {
              await handsInstance.send({ image: video });
            }
          },
          width: 1280,
          height: 720
        });

        await cameraInstance.start();
        setCameraError(null);
      } catch (err: any) {
        if (!isDestroyed) {
          console.error("Initialization failed:", err);
          let msg = err.message || String(err);
          const isIframe = window.self !== window.top;
          
          if (msg === "CAMERA_PERMISSION_DENIED" || msg.includes("Permission denied") || msg.includes("NotAllowedError")) {
            msg = isIframe ? "PERMISSION_DENIED_IFRAME" : "PERMISSION_DENIED";
          }
          setCameraError(msg);
        }
      }
    };

    runInit();

    return () => {
      isDestroyed = true;
      if (cameraInstance) {
        cameraInstance.stop();
      }
      if (handsInstance) {
        handsInstance.close();
      }
    };
  }, [saveToHistory, initRetry]); // Added initRetry as dependency

  // Keep settings in a ref for the effect to access current values without re-triggering
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);


  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black flex items-center justify-center">
      <AnimatePresence>
        {showSavedToast && (
          <motion.div 
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute top-24 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl glass-morphism border border-blue-500/30 text-white font-bold text-sm shadow-2xl shadow-blue-500/20 flex items-center gap-3"
          >
            <div className="w-6 h-6 bg-blue-500/20 rounded-full flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            Screenshot Saved!
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cinematic Flash & Shutter Effect for Screenshot */}
      <AnimatePresence>
        {isCapturing && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.8, 0] }}
              transition={{ duration: 0.15, times: [0, 0.4, 1] }}
              className="absolute inset-0 z-[190] bg-black pointer-events-none"
            />
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, times: [0, 0.2, 1], ease: "easeOut" }}
              className="absolute inset-0 z-[200] bg-white pointer-events-none"
            />
          </>
        )}
      </AnimatePresence>

      {cameraError && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-3xl p-6 text-center">
          <div className="max-w-md glass-morphism p-10 rounded-[2.5rem] border border-red-500/40 flex flex-col items-center gap-6 shadow-[0_0_50px_rgba(239,68,68,0.15)]">
            <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center text-red-500 shadow-[0_0_30px_rgba(239,68,68,0.3)]">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-white tracking-tight">
                {cameraError === 'PERMISSION_DENIED_IFRAME' ? 'Security Block Detected' : 'Camera Permission Denied'}
              </h2>
              <p className="text-gray-400 text-sm leading-relaxed px-4">
                {cameraError === 'PERMISSION_DENIED_IFRAME' 
                  ? "Browsers block camera access inside previews for security. You must open the app in a new tab to continue."
                  : "We need your camera to track hand gestures for drawing. Access is currently blocked."}
              </p>
            </div>

            <div className="w-full space-y-4">
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-left">
                <h3 className="text-xs font-bold text-red-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" />
                  {cameraError === 'PERMISSION_DENIED_IFRAME' ? 'Required Action' : 'How to Fix'}
                </h3>
                <ul className="text-gray-300 text-xs space-y-3 list-none">
                  {cameraError === 'PERMISSION_DENIED_IFRAME' ? (
                    <>
                      <li className="flex gap-3 text-blue-400 font-bold border-b border-blue-400/20 pb-2">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center font-bold text-[10px]">1</span>
                        Click the "OPEN IN NEW TAB" button below.
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/10 flex items-center justify-center font-bold text-[10px]">2</span>
                        Accept camera permissions in the new window.
                      </li>
                    </>
                  ) : (
                    <>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/10 flex items-center justify-center font-bold text-[10px]">1</span>
                        Click the <strong>Camera Icon</strong> or <strong>Lock Icon</strong> in your address bar.
                      </li>
                      <li className="flex gap-3">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/10 flex items-center justify-center font-bold text-[10px]">2</span>
                        Change "Block" to <strong>"Allow"</strong> for Camera.
                      </li>
                    </>
                  )}
                </ul>
              </div>

              <div className="flex flex-col gap-3">
                {cameraError === 'PERMISSION_DENIED_IFRAME' ? (
                  <button 
                    onClick={() => window.open(window.location.href, '_blank')}
                    className="w-full py-5 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-2xl transition-all shadow-xl shadow-blue-600/20 active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    OPEN IN NEW TAB ↗️
                  </button>
                ) : (
                  <button 
                    onClick={() => {
                      setCameraError(null);
                      setInitRetry(prev => prev + 1);
                    }}
                    className="w-full py-4 bg-white text-black hover:bg-gray-100 font-black rounded-2xl transition-all shadow-xl active:scale-[0.98]"
                  >
                    RETRY CONNECTION
                  </button>
                )}
                
                {cameraError !== 'PERMISSION_DENIED_IFRAME' && (
                  <button 
                    onClick={() => window.open(window.location.href, '_blank')}
                    className="w-full py-3 bg-white/5 hover:bg-white/10 text-white/70 text-xs font-bold rounded-2xl transition-all border border-white/10"
                  >
                    STILL BLOCKED? OPEN IN NEW TAB ↗️
                  </button>
                )}
              </div>
            </div>
            
            <div className="bg-black/40 rounded-xl px-3 py-1.5 text-[9px] font-mono text-gray-600 max-w-full truncate">
              {cameraError}
            </div>
          </div>
        </div>
      )}

      <video 
        ref={videoRef}
        className={`absolute inset-0 w-full h-full object-cover mirror ${settings.whiteboardBackground ? 'hidden' : 'block'}`}
        playsInline
        muted
      />
      {settings.whiteboardBackground && (
        <div className="absolute inset-0 bg-white" />
      )}
      <canvas ref={drawRef} className="absolute inset-0 w-full h-full object-cover mirror z-10" />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover mirror z-20 pointer-events-none" />

      <ControlPanel 
        settings={settings}
        setSettings={setSettings}
        onClear={clearBoard}
        onUndo={undo}
        onRedo={redo}
        canUndo={historyState.canUndo}
        canRedo={historyState.canRedo}
        currentGesture={gesture}
        fps={fps}
      />

      <div className="absolute bottom-6 left-6 z-30 flex flex-col gap-1 pointer-events-none">
        <div className={`px-4 py-1.5 rounded-full glass-morphism text-xs font-bold tracking-widest uppercase transition-all duration-300 ${gesture !== GestureState.IDLE ? 'opacity-100' : 'opacity-40'}`}>
          Mode: {gesture}
        </div>
      </div>

      {gesture === GestureState.IDLE && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 bg-black/40 backdrop-blur-md px-8 py-4 rounded-3xl border border-white/10 text-white animate-pulse text-sm text-center">
          👆 1 Finger: Drawing • 🖐 Palm: Erase <br/>
          ✊ Fist: Drag & Move • 👍 Thumbs Up: Screenshot
        </div>
      )}
    </div>
  );
};

export default App;
