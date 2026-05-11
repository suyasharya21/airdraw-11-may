
import React, { useState } from 'react';
import { Settings, GestureState } from '../types';
import { 
  Settings as SettingsIcon, 
  Undo2, 
  Redo2, 
  Trash2, 
  X, 
  MousePointer2, 
  Pen, 
  Highlighter, 
  Eraser 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ControlPanelProps {
  settings: Settings;
  setSettings: React.SetStateAction<Settings> | any;
  onClear: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  currentGesture: GestureState;
  fps: number;
}

const ControlPanel: React.FC<ControlPanelProps> = ({ 
  settings, 
  setSettings, 
  onClear, 
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  currentGesture,
  fps
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleChange = (key: keyof Settings, value: any) => {
    setSettings((prev: Settings) => ({ ...prev, [key]: value }));
  };

  const getGestureInfo = (state: GestureState) => {
    switch (state) {
      case GestureState.MARKER: 
        return { color: 'text-blue-600', icon: <Pen className="w-4 h-4" />, label: 'Drawing' };
      case GestureState.ERASER: 
        return { color: 'text-red-600', icon: <Eraser className="w-4 h-4" />, label: 'Eraser' };
      case GestureState.DRAG: 
        return { color: 'text-blue-500', icon: <MousePointer2 className="w-4 h-4" />, label: 'Dragging' };
      default: 
        return { color: 'text-gray-500', icon: <MousePointer2 className="w-4 h-4" />, label: 'Hovering' };
    }
  };

  const gestureInfo = getGestureInfo(currentGesture);

  return (
    <div className="fixed top-6 right-6 z-50 flex flex-col items-end gap-3 select-none">
      <motion.button 
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setIsOpen(!isOpen)}
        className="w-12 h-12 flex items-center justify-center glass-morphism rounded-full shadow-lg border border-white/40 transition-all"
        aria-label="Toggle Settings"
      >
        {isOpen ? <X className="h-6 w-6 text-gray-800" /> : <SettingsIcon className="h-6 w-6 text-gray-800" />}
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -20 }}
            className="w-80 glass-morphism rounded-3xl shadow-2xl flex flex-col border border-white/20 overflow-hidden max-h-[85vh]"
          >
            {/* Header */}
            <div className="flex justify-between items-center bg-white/10 p-5 border-b border-black/5">
              <div className="flex items-center gap-2">
                <SettingsIcon className="w-5 h-5 text-gray-700" />
                <h2 className="text-lg font-black text-gray-800 tracking-tight">App Settings</h2>
              </div>
              <span className="text-[10px] font-mono font-bold text-gray-500 bg-black/5 px-2 py-1 rounded-full">{fps} FPS</span>
            </div>

            {/* Scrollable Content Area */}
            <div className="overflow-y-auto p-5 custom-scrollbar flex-1 space-y-6">
              {/* Status Section */}
              <div className="bg-white/40 p-4 rounded-2xl border border-white/60 flex items-center gap-4 shadow-sm">
                <div className={`${gestureInfo.color} p-3 bg-white/60 rounded-xl shadow-inner`}>
                  {gestureInfo.icon}
                </div>
                <div>
                  <p className="text-[10px] uppercase font-black tracking-[0.1em] text-gray-400 mb-0.5">Live Mode</p>
                  <p className={`text-sm font-black ${gestureInfo.color} flex items-center gap-1`}>
                    <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse mr-1" />
                    {gestureInfo.label.toUpperCase()}
                  </p>
                </div>
              </div>

              {/* Tools Section */}
              <div className="space-y-4">
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Drawing Tools</h3>
                
                <div className="grid grid-cols-1 gap-4 bg-white/20 p-4 rounded-2xl border border-white/40">
                  <div className="flex items-center justify-between gap-4">
                    <label className="text-xs font-bold text-gray-700">Marker Color</label>
                    <input 
                      type="color" 
                      value={settings.markerColor}
                      onChange={(e) => handleChange('markerColor', e.target.value)}
                      className="w-12 h-8 rounded-lg cursor-pointer bg-white p-0.5 border border-black/5 shadow-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-end">
                      <label className="text-[11px] font-bold text-gray-600">Brush Size</label>
                      <span className="text-[10px] font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{settings.brushSize}px</span>
                    </div>
                    <input 
                      type="range" 
                      min="1" 
                      max="50" 
                      value={settings.brushSize}
                      onChange={(e) => handleChange('brushSize', parseInt(e.target.value))}
                      className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-end">
                      <label className="text-[11px] font-bold text-gray-600">Opacity</label>
                      <span className="text-[10px] font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">{Math.round(settings.opacity * 100)}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="1.0" 
                      step="0.05"
                      value={settings.opacity}
                      onChange={(e) => handleChange('opacity', parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />
                  </div>
                </div>
              </div>

              {/* Eraser Section */}
              <div className="space-y-4">
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">Eraser Tool</h3>
                <div className="bg-white/20 p-4 rounded-2xl border border-white/40 space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between items-end">
                      <label className="text-[11px] font-bold text-gray-600">Eraser Reach</label>
                      <span className="text-[10px] font-mono font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">{settings.eraserSize}px</span>
                    </div>
                    <input 
                      type="range" 
                      min="20" 
                      max="150" 
                      value={settings.eraserSize}
                      onChange={(e) => handleChange('eraserSize', parseInt(e.target.value))}
                      className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-red-500"
                    />
                  </div>
                </div>
              </div>

              {/* View Section */}
              <div className="space-y-4">
                <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">View Options</h3>
                <div className="bg-white/20 p-4 rounded-2xl border border-white/40">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-700">Digital Whiteboard</label>
                    <button 
                      onClick={() => handleChange('whiteboardBackground', !settings.whiteboardBackground)}
                      className={`w-11 h-6 rounded-full relative transition-all duration-300 shadow-inner ${settings.whiteboardBackground ? 'bg-green-500 shadow-green-900/10' : 'bg-gray-300'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-300 shadow-md ${settings.whiteboardBackground ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>
                  <p className="text-[9px] text-gray-500 mt-2 leading-tight">Switch to a clean white background or keep the transparent camera view.</p>
                </div>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="p-5 bg-white/20 border-t border-black/5 space-y-4">
              <div className="flex gap-2">
                <motion.button 
                  whileTap={{ scale: 0.95 }}
                  onClick={onUndo}
                  disabled={!canUndo}
                  className={`flex-1 py-3 px-2 rounded-xl border flex items-center justify-center transition-all shadow-sm ${canUndo ? 'bg-white hover:bg-gray-50 text-gray-700 border-gray-200' : 'bg-gray-100 text-gray-300 border-gray-100 cursor-not-allowed opacity-50'}`}
                  title="Undo last stroke"
                >
                  <Undo2 className="h-5 w-5" />
                </motion.button>
                <motion.button 
                  whileTap={{ scale: 0.95 }}
                  onClick={onRedo}
                  disabled={!canRedo}
                  className={`flex-1 py-3 px-2 rounded-xl border flex items-center justify-center transition-all shadow-sm ${canRedo ? 'bg-white hover:bg-gray-50 text-gray-700 border-gray-200' : 'bg-gray-100 text-gray-300 border-gray-100 cursor-not-allowed opacity-50'}`}
                  title="Redo stroke"
                >
                  <Redo2 className="h-5 w-5" />
                </motion.button>
              </div>
              
              <motion.button 
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => { onClear(); setIsOpen(false); }}
                className="w-full py-3.5 px-4 bg-red-500 hover:bg-red-400 text-white text-xs font-black rounded-xl border border-red-400 shadow-[0_4px_12px_rgba(239,68,68,0.2)] transition-all flex items-center justify-center gap-2 uppercase tracking-widest"
              >
                <Trash2 className="h-4 w-4" />
                Reset Whiteboard
              </motion.button>

              <div className="text-[9px] text-gray-400 font-bold text-center leading-relaxed">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <span className="w-1 h-1 bg-gray-300 rounded-full" />
                  GESTURE GUIDE
                  <span className="w-1 h-1 bg-gray-300 rounded-full" />
                </div>
                👆 DRAW • 🖐 ERASE • ✊ DRAG • 👍 SCREENSHOT
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ControlPanel;
