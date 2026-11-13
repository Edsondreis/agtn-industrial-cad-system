export * from "./model";
export { solveSheet, setbackFor, trimOutline, loopArea, contourProfile, type ContourSegment } from "./solve";
export { TOL, numAbs, dimAbs, interfVol, interfArea } from "./tolerance";
export * as sheetMath from "./math";
export type { V2 as SheetV2, V3 as SheetV3, Mat as SheetMat } from "./math";
export { flatPattern, flatEntities, type FlatPattern, type FlatBend, type FlatEntityOptions } from "./flat";
export { sheetWarnings, genericOpReason } from "./validate";
