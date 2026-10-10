/** Height-above-river flood grid: which cells are wet at a given river rise, and how deep. */

export type GridMeta = { w: number; h: number; bounds: [number, number, number, number]; never: number; impassable_dm: number };

export class FloodGrid {
  readonly level: Uint16Array;
  readonly hand: Uint16Array;
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  /** Square metres per cell (Web Mercator z14 pixel at this latitude). */
  readonly cellM2: number;

  constructor(readonly meta: GridMeta, buf: ArrayBuffer) {
    const n = meta.w * meta.h;
    this.level = new Uint16Array(buf, 0, n);
    this.hand = new Uint16Array(buf, n * 2, n);
    this.canvas = document.createElement("canvas");
    this.canvas.width = meta.w;
    this.canvas.height = meta.h;
    this.ctx = this.canvas.getContext("2d")!;
    this.img = this.ctx.createImageData(meta.w, meta.h);
    const lat = (meta.bounds[1] + meta.bounds[3]) / 2;
    const m = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** 14;
    this.cellM2 = m * m;
  }

  static async load(): Promise<FloodGrid> {
    const [meta, buf] = await Promise.all([
      fetch("/data/grid.json").then((r) => r.json()),
      fetch("/data/grid.bin").then((r) => r.arrayBuffer()),
    ]);
    return new FloodGrid(meta, buf);
  }

  /** Paint the flood for a rise (decimetres) and return the flooded land area in km² (channel excluded). */
  render(riseDm: number): number {
    const { level, hand } = this;
    const d = this.img.data;
    let wet = 0;
    for (let i = 0; i < level.length; i++) {
      const o = i * 4;
      if (level[i] <= riseDm && level[i] > 0) {
        wet++;
        const depth = riseDm - hand[i];
        // shallow: pale cyan, deep: saturated blue
        if (depth < 3) { d[o] = 125; d[o + 1] = 211; d[o + 2] = 252; d[o + 3] = 120; }
        else if (depth < 10) { d[o] = 56; d[o + 1] = 152; d[o + 2] = 236; d[o + 3] = 160; }
        else if (depth < 25) { d[o] = 29; d[o + 1] = 99; d[o + 2] = 214; d[o + 3] = 185; }
        else { d[o] = 23; d[o + 1] = 55; d[o + 2] = 160; d[o + 3] = 205; }
      } else if (level[i] === 0) {
        // the channel itself: always water, never counted as flooding
        d[o] = 30; d[o + 1] = 64; d[o + 2] = 110; d[o + 3] = 200;
      } else {
        d[o + 3] = 0;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
    return (wet * this.cellM2) / 1e6;
  }

  cellAt(lon: number, lat: number): number {
    const [w, , e] = this.meta.bounds;
    const n = 2 ** 14 * 256;
    const x0 = ((w + 180) / 360) * n;
    const x = ((lon + 180) / 360) * n - x0;
    const r = (lat * Math.PI) / 180;
    const yAbs = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
    const rn = (this.meta.bounds[3] * Math.PI) / 180;
    const y0 = ((1 - Math.log(Math.tan(rn) + 1 / Math.cos(rn)) / Math.PI) / 2) * n;
    const xi = Math.floor(x), yi = Math.floor(yAbs - y0);
    if (lon < w || lon > e || xi < 0 || yi < 0 || xi >= this.meta.w || yi >= this.meta.h) return -1;
    return yi * this.meta.w + xi;
  }

  /** Water depth in dm at a point, 0 if dry, -1 if outside the modelled area. */
  depthAt(lon: number, lat: number, riseDm: number): number {
    const i = this.cellAt(lon, lat);
    if (i < 0) return -1;
    return this.level[i] <= riseDm ? Math.max(0, riseDm - this.hand[i]) : 0;
  }
}
