// Quick builders: dorm rows and the sample project.
import { newRoom, newDoor, newStairs, newMarker, newLabel, newMap, newProject, uid } from './model.js';

/**
 * A row of dorm rooms along a hallway.
 * o: { x, y, count, roomW, roomH, hallH, sides: 'top'|'bottom'|'both', characters:[ids], namePrefix, makeHall }
 * Rooms on 'top' sit above the hall with their doors on the hall's top edge.
 */
export function dormRow(o) {
  const els = [];
  const sides = o.sides === 'both' ? ['top', 'bottom'] : [o.sides];
  const perSide = o.sides === 'both' ? Math.ceil(o.count / 2) : o.count;
  const hallY = o.y + (sides.includes('top') ? o.roomH : 0);
  const len = perSide * o.roomW;
  if (o.makeHall) {
    const hall = newRoom('hall', { x: o.x, y: hallY, w: len, h: o.hallH }, 'Dorm hallway');
    hall.showLabel = false;
    els.push(hall);
  }
  let n = 0;
  for (const side of sides) {
    for (let i = 0; i < perSide && n < o.count; i++, n++) {
      const rx = o.x + i * o.roomW;
      const ry = side === 'top' ? hallY - o.roomH : hallY + o.hallH;
      const r = newRoom('room', { x: rx, y: ry, w: o.roomW, h: o.roomH });
      const chId = o.characters?.[n] ?? '';
      r.characterId = chId;
      r.name = chId && o.charNames?.[chId] ? `${o.charNames[chId]}'s room` : `${o.namePrefix || 'Dorm'} ${n + 1}`;
      r.showLabel = !chId;
      r.discover = 'always';
      r.tags = 'dorm';
      els.push(r);
      const doorX = rx + Math.floor((o.roomW - 1) / 2);
      els.push(newDoor(doorX, side === 'top' ? hallY : hallY + o.hallH, 'h', 1));
    }
  }
  return els;
}

export function sampleProject() {
  const p = newProject('TVF Academy (sample)');
  const names = Object.fromEntries(p.characters.map((c) => [c.id, c.name]));
  const f1 = p.maps[0];
  f1.name = '1F'; f1.building = 'School';
  const f2 = newMap('2F', 2); f2.building = 'School';
  const gym = newMap('Gymnasium', 1); gym.building = 'Gym'; gym.ox = -30; gym.oy = 4;
  p.maps.push(f2, gym);
  const E = f1.elements;

  // --- 1F -------------------------------------------------------------------------
  // entrance hall (irregular shape = several rects in one hall)
  const entrance = newRoom('hall', { x: 2, y: 9, w: 8, h: 8 }, 'Entrance Hall');
  entrance.rects.push({ x: 10, y: 11, w: 4, h: 4 });
  entrance.showLabel = true;
  E.push(entrance);
  // main corridor east and the dorm wing
  E.push(newRoom('hall', { x: 14, y: 11, w: 6, h: 3 }, 'Main corridor'));
  const cast = p.characters.map((c) => c.id);
  E.push(...dormRow({ x: 20, y: 6, count: 12, roomW: 3, roomH: 5, hallH: 3, sides: 'both', characters: cast, charNames: names, makeHall: true }));
  // the dorm hall above is at y=11..14, from x=20 to x=38
  // north corridor with toilets and trash room
  E.push(newRoom('hall', { x: 38, y: 3, w: 3, h: 16 }, 'East corridor'));
  E.push(newRoom('hall', { x: 14, y: 3, w: 24, h: 3 }, 'North corridor'));
  E.push(newRoom('hall', { x: 14, y: 6, w: 3, h: 5 }, ''));
  E.push(newRoom('blocked', { x: 17, y: 6, w: 3, h: 5 }));
  const wcm = newRoom('room', { x: 16, y: 0, w: 2, h: 3 }, 'Toilet (M)'); wcm.icon = 'wc-m'; wcm.showLabel = false; E.push(wcm);
  const wcf = newRoom('room', { x: 18, y: 0, w: 2, h: 3 }, 'Toilet (F)'); wcf.icon = 'wc-f'; wcf.showLabel = false; E.push(wcf);
  const trash = newRoom('room', { x: 21, y: 0, w: 10, h: 3 }, 'Trash Room'); trash.icon = 'trash'; trash.showLabel = false; trash.locked = true; E.push(trash);
  E.push(newDoor(16, 3, 'h'), newDoor(18, 3, 'h'));
  const trashDoor = newDoor(25, 3, 'h', 2); trashDoor.lock = 'barred'; trashDoor.lockMsg = 'A shutter blocks the trash room. Someone has the key…'; E.push(trashDoor);
  // west rooms
  const bath = newRoom('room', { x: 2, y: 2, w: 5, h: 7 }, 'Bathhouse'); bath.icon = 'bath'; bath.showLabel = false; E.push(bath);
  const laundry = newRoom('room', { x: 7, y: 2, w: 4, h: 7 }, 'Laundry'); laundry.icon = 'shirt'; laundry.showLabel = false; E.push(laundry);
  const store = newRoom('room', { x: 11, y: 8, w: 3, h: 3 }, 'School Store'); store.icon = 'shop'; store.showLabel = false; E.push(store);
  E.push(newDoor(4, 9, 'h'), newDoor(8, 9, 'h'), newDoor(12, 11, 'h'));
  const blocked1 = newRoom('blocked', { x: 10, y: 15, w: 4, h: 2 }); E.push(blocked1);
  // south: dining hall, kitchen, warehouse, stairs
  const dining = newRoom('room', { x: 1, y: 18, w: 7, h: 7 }, 'Dining Hall'); dining.icon = 'food'; dining.showLabel = false; dining.discover = 'always'; E.push(dining);
  const kitchen = newRoom('room', { x: 8, y: 18, w: 3, h: 3 }, 'Kitchen'); kitchen.icon = 'chef'; kitchen.showLabel = false; E.push(kitchen);
  const ware = newRoom('room', { x: 11, y: 18, w: 4, h: 6 }, 'Warehouse'); ware.icon = 'box'; ware.showLabel = false; E.push(ware);
  E.push(newRoom('hall', { x: 2, y: 17, w: 8, h: 1 }, ''));
  E.push(newRoom('hall', { x: 15, y: 14, w: 3, h: 6 }, ''));
  E.push(newDoor(4, 18, 'h', 2), newDoor(8, 19, 'v'), newDoor(15, 20, 'v'));
  const st1 = newStairs({ x: 15, y: 20, w: 3, h: 5 }, 's'); st1.name = 'Stairs to 2F'; st1.goes = 'up'; st1.showLabel = true; E.push(st1);
  // exit to the gym
  const exit = newMarker('portal', 1.5, 13); exit.name = 'To the Gym'; exit.rot = 270; E.push(exit);
  const entranceDoor = newDoor(2, 12, 'v', 2); entranceDoor.name = 'Front doors'; entranceDoor.style = 'double'; E.push(entranceDoor);
  const gymLabel = newLabel(-1.5, 13, 'Gym ←'); E.push(gymLabel);
  // markers
  const spawn = newMarker('spawn', 5, 13); spawn.rot = 90; E.push(spawn);
  const nina = newMarker('npc', 7, 12); nina.characterId = 'chr_nina'; nina.name = 'Nina'; nina.rot = 270; nina.text = "You're finally awake! Come on, everyone's in the dining hall."; E.push(nina);
  const king = newMarker('npc', 4, 21); king.characterId = 'chr_king'; king.name = 'King'; king.text = "Don't just stand there. Sit down."; king.cond.chMin = 0; E.push(king);
  const kingNight = newMarker('npc', 29, 12.5); kingNight.characterId = 'chr_king'; kingNight.name = 'King'; kingNight.text = 'It\'s nighttime. Go to bed.'; kingNight.cond.times = [3]; E.push(kingNight);
  king.cond.times = [0, 1, 2];
  const hot = newMarker('hotspot', 13, 21); hot.name = 'Shelves'; hot.text = 'Rows of supplies. A box of tape is missing.'; E.push(hot);
  const ev = { id: uid('ev'), name: "Cameron's Account", desc: 'Cameron says nobody passed the dining hall after 10pm.' };
  p.evidence.push(ev);
  const evm = newMarker('evidence', 6, 23); evm.name = "Cameron's Account"; evm.evidenceId = ev.id; evm.required = true; evm.cond.chMin = 1; evm.cond.chMax = 1; E.push(evm);
  const ann = newMarker('trigger', 30, 12.5); ann.name = 'Night announcement'; ann.w = 4; ann.h = 3; ann.triggerType = 'announcement'; ann.text = 'Ahem! It is now officially nighttime.'; ann.cond.times = [3]; E.push(ann);
  for (const [x, y] of [[6, 13], [29, 12.5], [4, 21]]) { const l = newMarker('light', x, y); E.push(l); }
  const table = newMarker('prop', 4.5, 22.5); table.name = 'Long table'; table.w = 4; table.h = 1; table.height = 0.75; table.color = '#8a5a44'; table.icon = ''; E.push(table);
  const cam = newMarker('camera', 3, 9.5); cam.rot = 135; cam.name = 'Monitor'; E.push(cam);
  for (const [name, x, y] of [['Hallway to the dorms', 16, 12.5], ['Near Dining Hall', 5, 17.5], ['Entrance Hall', 6, 10.5]]) {
    const j = newMarker('jump', x, y); j.name = name; E.push(j);
  }
  const flag = { id: uid('flag'), name: 'trash_room_key', desc: 'Player has the trash room key' };
  p.flags.push(flag);
  trashDoor.unlockFlag = flag.id;

  // --- 2F ---------------------------------------------------------------------------
  const F = f2.elements;
  F.push(newRoom('hall', { x: 15, y: 8, w: 3, h: 17 }, '2F corridor'));
  F.push(newRoom('hall', { x: 4, y: 8, w: 11, h: 3 }, ''));
  const st2 = newStairs({ x: 15, y: 20, w: 3, h: 5 }, 'n'); st2.name = 'Stairs to 1F'; st2.goes = 'down'; st2.showLabel = true; F.push(st2);
  // shift: stairs on 2F cover the bottom of the corridor; trim the corridor
  F[0].rects = [{ x: 15, y: 8, w: 3, h: 12 }];
  const lib = newRoom('room', { x: 4, y: 1, w: 7, h: 7 }, 'Library'); lib.icon = 'book'; lib.showLabel = false; F.push(lib);
  const classA = newRoom('room', { x: 18, y: 8, w: 6, h: 5 }, 'Classroom 2-A'); classA.icon = 'computer'; F.push(classA);
  const classB = newRoom('room', { x: 18, y: 13, w: 6, h: 5 }, 'Classroom 2-B'); classB.icon = 'computer'; classB.cond.chMin = 2; F.push(classB);
  const pool = newRoom('room', { x: 4, y: 11, w: 11, h: 9 }, 'Pool'); pool.icon = 'pool'; pool.showLabel = false; pool.cond.chMin = 2; F.push(pool);
  F.push(newDoor(7, 8, 'h'), newDoor(18, 10, 'v'), newDoor(18, 15, 'v'));
  const poolDoor = newDoor(9, 11, 'h', 2); poolDoor.cond.chMin = 2; F.push(poolDoor);
  const shutter = newDoor(15, 8, 'h', 3); shutter.lock = 'barred'; shutter.lockMsg = 'The way to 3F is shuttered. It opens after the next trial.'; F.push(shutter);
  const sp2 = newMarker('light', 16.5, 12); F.push(sp2);
  const j2 = newMarker('jump', 16.5, 14); j2.name = '2F corridor'; F.push(j2);
  const maia = newMarker('fte', 7, 4); maia.characterId = 'chr_maia'; maia.name = 'Maia'; maia.text = 'Maia is reading quietly.'; F.push(maia);

  // links between the stairs
  st1.link = { mapId: f2.id, targetId: st2.id };
  st2.link = { mapId: f1.id, targetId: st1.id };

  // --- Gym --------------------------------------------------------------------------
  const G = gym.elements;
  const gh = newRoom('room', { x: 0, y: 0, w: 14, h: 10 }, 'Gymnasium'); gh.icon = 'gym'; gh.showLabel = false; gh.wallHeight = 7; gh.lighting = 'cold'; G.push(gh);
  const lobby = newRoom('hall', { x: 14, y: 3, w: 4, h: 4 }, 'Gym lobby'); G.push(lobby);
  G.push(newDoor(14, 4, 'v', 2));
  const back = newMarker('portal', 17.5, 5); back.name = 'To the school'; back.rot = 90; G.push(back);
  const trophies = newMarker('hotspot', 16, 3.5); trophies.name = 'Trophy case'; trophies.text = 'Dusty trophies. One of them is missing.'; G.push(trophies);
  const stage = newMarker('prop', 7, 1); stage.name = 'Stage'; stage.w = 8; stage.h = 2; stage.height = 1; stage.color = '#6b4a3a'; stage.icon = ''; G.push(stage);
  const lola = newMarker('npc', 7, 3); lola.characterId = 'chr_lola'; lola.name = 'Lola'; lola.rot = 180; lola.text = 'Welcome, welcome! Everyone take a seat.'; G.push(lola);
  const ross = newMarker('npc', 8.5, 3); ross.characterId = 'chr_rossisco'; ross.name = 'Rossisco'; ross.rot = 180; ross.text = '…'; G.push(ross);
  G.push(newMarker('light', 7, 5));
  exit.link = { mapId: gym.id, targetId: back.id };
  back.link = { mapId: f1.id, targetId: exit.id };

  p.startMapId = f1.id;
  return p;
}
