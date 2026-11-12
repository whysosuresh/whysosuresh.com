// @ts-check
// A public thread's preview card painted (site/app/card.js lays it out): the background, each line and his photo
// cropped round, or his initial, on a 1200 x 630 canvas, answered as a PNG for his page to upload. The only part of
// the card that needs a browser, so it sits apart from the layout, which a test runs in Node. It decides nothing and
// asks the network for nothing; its caller hands it his photo already loaded.

import { CARD_HEIGHT, CARD_WIDTH, layoutCard } from './card.js';

/**
 * @typedef {import('./card.js').Card} Card
 * @typedef {import('./card.js').CardStyle} CardStyle
 * @typedef {import('./card.js').CardLayout} CardLayout
 * @typedef {import('./card.js').Measure} Measure
 * @typedef {import('./card.js').Tone} Tone
 */

/**
 * Paints a laid-out card: the background, each line, and his photo cropped round (or his initial on a disc in the
 * card's text colour). Decides nothing.
 * @param {CanvasRenderingContext2D} context @param {CardLayout} layout
 * @param {HTMLImageElement | ImageBitmap | null} face his photo, or null for his initial
 */
export function paintCard(context, layout, face) {
  const tone = (/** @type {Tone} */ name) => layout[name];
  context.save();
  context.fillStyle = layout.background;
  context.fillRect(0, 0, layout.width, layout.height);
  context.textBaseline = 'alphabetic';
  for (const line of layout.lines) {
    context.font = line.font;
    context.fillStyle = tone(line.tone);
    context.textAlign = line.align;
    context.fillText(line.text, line.x, line.y);
  }
  const { x, y, size, initial } = layout.face;
  context.beginPath();
  context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  context.closePath();
  context.clip();
  if (face !== null) {
    const width = 'naturalWidth' in face ? face.naturalWidth : face.width;
    const height = 'naturalHeight' in face ? face.naturalHeight : face.height;
    const side = Math.min(width, height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(face, (width - side) / 2, (height - side) / 2, side, side, x, y, size, size);
  } else {
    context.fillStyle = layout.ink;
    context.fillRect(x, y, size, size);
    context.font = initial.font;
    context.fillStyle = tone(initial.tone);
    context.textAlign = initial.align;
    context.fillText(initial.text, initial.x, initial.y);
  }
  context.restore();
}

/**
 * The card as a PNG, drawn on a canvas of its own with that canvas's own measure. The only part that needs a browser.
 * @param {Card} card @param {CardStyle} style @param {HTMLImageElement | ImageBitmap | null} face
 * @returns {Promise<Blob>}
 */
export function cardBlob(card, style, face) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const context = canvas.getContext('2d');
  if (context === null) return Promise.reject(new Error('no canvas'));
  /** @type {Measure} */
  const measure = (text, font) => {
    context.font = font;
    return context.measureText(text).width;
  };
  paintCard(context, layoutCard(card, style, measure), face);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob === null ? reject(new Error('no picture')) : resolve(blob)), 'image/png'));
}
