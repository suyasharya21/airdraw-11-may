
export enum GestureState {
  IDLE = 'IDLE',
  MARKER = 'MARKER',
  ERASER = 'ERASER',
  SCREENSHOT = 'SCREENSHOT',
  DRAG = 'DRAG'
}

export interface Point {
  x: number;
  y: number;
}

export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export interface Stroke {
  id: string;
  points: Point[];
  color: string;
  size: number;
  opacity: number;
}

export interface Settings {
  markerColor: string;
  brushSize: number;
  eraserSize: number;
  opacity: number;
  whiteboardBackground: boolean;
}
