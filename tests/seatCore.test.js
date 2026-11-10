import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSeatMap, toggleSeat, totalPrice, demoBookingResult } from '../src/seatCore.js';
const seats = makeSeatMap();
test('96 unique seats with coordinates',()=>{assert.equal(seats.length,96);assert.equal(new Set(seats.map(s=>s.id)).size,96);assert.ok(seats.every(s=>Number.isFinite(s.x)&&Number.isFinite(s.z)));});
test('unavailable seats cannot be selected',()=>{assert.deepEqual(toggleSeat([],seats.find(s=>s.id==='A3')),[]);assert.deepEqual(toggleSeat([],seats.find(s=>s.id==='B3')),[]);});
test('toggle and selection limit',()=>{const s=seats.find(s=>s.id==='A1');assert.deepEqual(toggleSeat([],s),['A1']);assert.deepEqual(toggleSeat(['A1'],s),[]);assert.deepEqual(toggleSeat(['A1','A2','A5','A6','A7','A8'],s),['A2','A5','A6','A7','A8']);assert.equal(toggleSeat(['A1','A2','A5','A6','A7','A8'],seats.find(s=>s.id==='A9')).length,6);});
test('price sums selected seats only',()=>{assert.equal(totalPrice(seats,['A1','H1']),43000);assert.equal(totalPrice(seats,[]),0);});
test('demo cannot assert bookings',()=>{assert.equal(demoBookingResult().success,false);});
