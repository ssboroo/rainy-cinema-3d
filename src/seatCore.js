/** Demo-only seat data, NOT connected to a cinema ticketing provider. */
export const ROWS = 'ABCDEFGH'.split('');
export const COLUMNS = 12;
export const DEMO_UNAVAILABLE = new Set(['A3','A4','B7','C2','C3','D9','D10','E5','F11','G1','G2','H8']);
export const DEMO_HELD = new Set(['B3','F6']);
export const getSeatType = (row, col) => row === 'H' ? 'vip' : (col === 1 && row === 'A' ? 'accessible' : 'standard');
export function makeSeatMap() {
  return ROWS.flatMap((row, ri) => Array.from({ length: COLUMNS }, (_, i) => {
    const col = i + 1, id = `${row}${col}`;
    return { id, row, col, x: (col - 6.5) * 1.12 + (col > 6 ? .45 : -.45), z: ri * 1.32 - 4.5, type: getSeatType(row, col), status: DEMO_UNAVAILABLE.has(id) ? 'sold' : DEMO_HELD.has(id) ? 'held' : 'available', price: row === 'H' ? 25000 : 18000 };
  }));
}
export function toggleSeat(selected, seat, limit = 6) {
  if (seat.status !== 'available') return selected;
  if (selected.includes(seat.id)) return selected.filter(id => id !== seat.id);
  if (selected.length >= limit) return selected;
  return [...selected, seat.id];
}
export function totalPrice(seats, selected) {
  return seats.filter(seat => selected.includes(seat.id)).reduce((sum, seat) => sum + seat.price, 0);
}
export function demoBookingResult() {
  return { success: false, code: 'DEMO_ONLY', message: 'This demo does not create a real booking. Connect a verified cinema adapter.' };
}
