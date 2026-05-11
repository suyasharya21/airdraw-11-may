
import { HandLandmark, GestureState } from '../types';

/**
 * Calculates Euclidean distance between two 3D landmarks
 */
export const getDistance = (p1: HandLandmark, p2: HandLandmark): number => {
  return Math.sqrt(
    Math.pow(p1.x - p2.x, 2) + 
    Math.pow(p1.y - p2.y, 2) + 
    Math.pow(p1.z - p2.z, 2)
  );
};

/**
 * Main State Machine logic
 */
export const detectGesture = (landmarks: HandLandmark[]): GestureState => {
  if (!landmarks || landmarks.length === 0) return GestureState.IDLE;

  const indexTip = landmarks[8];
  const indexMCP = landmarks[5];
  const middleTip = landmarks[12];
  const middleMCP = landmarks[9];
  const ringTip = landmarks[16];
  const ringMCP = landmarks[13];
  const pinkyTip = landmarks[20];
  const pinkyMCP = landmarks[17];

  const thumbTip = landmarks[4];
  const thumbBase = landmarks[2];

  const wrist = landmarks[0];

  // Scale-invariant hand size reference (wrist to middle MCP)
  const handScale = getDistance(wrist, middleMCP);

  // Robust extension check: Tip is significantly further from wrist than MCP
  const tipWristDist = (tip: HandLandmark) => getDistance(tip, wrist);
  const mcpWristDist = (mcp: HandLandmark) => getDistance(mcp, wrist);

  const indexDist = getDistance(indexTip, indexMCP);
  const middleDist = getDistance(middleTip, middleMCP);
  const ringDist = getDistance(ringTip, ringMCP);
  const pinkyDist = getDistance(pinkyTip, pinkyMCP);

  const indexExtended = tipWristDist(indexTip) > mcpWristDist(indexMCP) * 1.1 || indexDist > handScale * 0.6;
  const middleExtended = tipWristDist(middleTip) > mcpWristDist(middleMCP) * 1.1 || middleDist > handScale * 0.6;
  const ringExtended = tipWristDist(ringTip) > mcpWristDist(ringMCP) * 1.1 || ringDist > handScale * 0.6;
  const pinkyExtended = tipWristDist(pinkyTip) > mcpWristDist(pinkyMCP) * 1.1 || pinkyDist > handScale * 0.6;
  
  // Are fingers tightly curled? (Tips closer to wrist than middle joint)
  // Ensure we don't count it as curled if it's pointing at the camera (large Tip-MCP distance)
  const indexCurled = tipWristDist(indexTip) < mcpWristDist(indexMCP) * 0.95 && indexDist < handScale * 0.45;
  const middleCurled = tipWristDist(middleTip) < mcpWristDist(middleMCP) * 0.95 && middleDist < handScale * 0.45;
  const ringCurled = tipWristDist(ringTip) < mcpWristDist(ringMCP) * 0.95 && ringDist < handScale * 0.45;
  const pinkyCurled = tipWristDist(pinkyTip) < mcpWristDist(pinkyMCP) * 0.95 && pinkyDist < handScale * 0.45;

  // Thumb extended check: distance from index base to thumb tip, relative to hand scale
  const thumbExtended = getDistance(thumbTip, indexMCP) > handScale * 0.35; 
  // Thumb Up: tip is above base, and tip is significantly above wrist (scaled)
  const thumbUp = thumbTip.y < thumbBase.y && thumbTip.y < wrist.y - (handScale * 0.2);

  // 1. Fist/Drag: Fingers tightly curled
  if (indexCurled && middleCurled && ringCurled && pinkyCurled && !thumbExtended) {
    return GestureState.DRAG;
  }

  // 2. Screenshot: Thumbs Up (Thumb extended and UP, others CURLED)
  // Strict check: thumb must be extended, pointing up, and all 4 other fingers must be curled.
  // Additionally, thumb tip must be higher (smaller Y) than average finger tips and average MCPs.
  const avgFingerY = (indexTip.y + middleTip.y + ringTip.y + pinkyTip.y) / 4;
  const avgMCPY = (indexMCP.y + middleMCP.y + ringMCP.y + pinkyMCP.y) / 4;
  
  const isThumbHighest = thumbTip.y < avgFingerY - (handScale * 0.1) && thumbTip.y < avgMCPY - (handScale * 0.1);

  if (thumbExtended && thumbUp && indexCurled && middleCurled && ringCurled && pinkyCurled && isThumbHighest) {
    return GestureState.SCREENSHOT;
  }

  // 3. Eraser: All 5 fingers extended (Full Open Palm)
  if (indexExtended && middleExtended && ringExtended && pinkyExtended && thumbExtended) {
    return GestureState.ERASER;
  }

  // 4. Marker: Index is NOT curled, but others are curled
  if (!indexCurled && middleCurled && ringCurled && pinkyCurled) {
    return GestureState.MARKER;
  }

  return GestureState.IDLE;
};
