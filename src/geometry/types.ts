export interface Point {
  x: number;
  y: number;
}

/** 3×3 matrix, row-major: [h11, h12, h13, h21, h22, h23, h31, h32, h33]. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];
