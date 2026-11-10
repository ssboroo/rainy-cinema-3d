import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, RoundedBox, Text } from '@react-three/drei';
import { makeSeatMap, toggleSeat, totalPrice } from './seatCore.js';
import './style.css';
const labels = { mn: { demo:'ТУРШИЛТЫН ОРЧИН', title:'Кино танхимыг өөр өнцгөөс', subtitle:'Суудлаа 3D орчинд сонгож, дэлгэцийн харагдах байдлыг урьдчилан үзээрэй.', select:'Суудал сонгох', choose:'Суудлаа сонгоно уу', seats:'Сонгосон суудал', price:'Нийт үнэ', continue:'Үргэлжлүүлэх', notice:'Энэ бол загвар demo. Бодит захиалга эсвэл төлбөр хийгдэхгүй.', screen:'ДЭЛГЭЦ', view:'Суудлаас харах', back:'Танхим руу буцах', hall:'Танхим 01', standard:'Энгийн', vip:'VIP', available:'Сул', sold:'Зарагдсан', held:'Түр хадгалсан', selected:'Сонгосон', preview:'3D харагдац', twoD:'2D зураглал', reset:'Цэвэрлэх', status:'Бодит захиалгын холболт идэвхгүй' }, en: {demo:'DEMO ENVIRONMENT', title:'Cinema from another angle', subtitle:'Choose your seat in 3D and preview the screen view.', select:'Choose seats', choose:'Choose your seats', seats:'Selected seats', price:'Total', continue:'Continue', notice:'Demonstration only. No real reservation or payment is created.', screen:'SCREEN', view:'Seat view', back:'Back to hall', hall:'Auditorium 01', standard:'Standard',vip:'VIP',available:'Available',sold:'Sold',held:'Held',selected:'Selected',preview:'3D view',twoD:'2D map',reset:'Clear',status:'Live booking provider not connected' } };
const fmt = n => new Intl.NumberFormat('mn-MN').format(n) + '₮';
const seatColor = (seat, selected) => selected.includes(seat.id) ? '#37dca5' : seat.status === 'sold' ? '#40495e' : seat.status === 'held' ? '#876a4d' : seat.type === 'vip' ? '#d4ac67' : '#4963af';
function Seat3D({ seat, selected, onClick }) {
  const chosen = selected.includes(seat.id), inactive = seat.status !== 'available';
  return <group position={[seat.x, .18, seat.z]} onClick={e => { e.stopPropagation(); onClick(seat); }}>
    <RoundedBox args={[.87,.22,.72]} radius={.11} smoothness={3} position={[0,.36,0]}><meshStandardMaterial color={seatColor(seat, selected)} metalness={.15} roughness={.55}/></RoundedBox>
    <RoundedBox args={[.87,.96,.18]} radius={.09} smoothness={3} position={[0,.81,.31]}><meshStandardMaterial color={seatColor(seat,selected)} roughness={.68}/></RoundedBox>
    <RoundedBox args={[.12,.37,.61]} radius={.05} position={[-.48,.48,0]}><meshStandardMaterial color="#243044"/></RoundedBox>
    <RoundedBox args={[.12,.37,.61]} radius={.05} position={[.48,.48,0]}><meshStandardMaterial color="#243044"/></RoundedBox>
    <Text position={[0,1.34,.43]} fontSize={.18} color={chosen ? '#7affd6' : inactive ? '#9196a1' : '#e9efff'} anchorX="center">{seat.id}</Text>
  </group>;
}
function CameraDirector({ seat }) {
  const { camera } = useThree();
  useEffect(() => {
    if (seat) {
      camera.position.set(seat.x, 1.45, seat.z + 1.05);
      camera.lookAt(0, 4.05, -9.35);
    } else {
      camera.position.set(0, 13, 20);
      camera.lookAt(0, 0, -1);
    }
    camera.updateProjectionMatrix();
  }, [camera, seat]);
  return null;
}
function HallScene({ seats, selected, onClick, previewSeat, fallbackText }) {
  return <Canvas shadows dpr={[1,1.75]} camera={{ position:[0,13,20], fov:46 }} gl={{ antialias:true }} fallback={<div className="webgl-fallback">{fallbackText}</div>}>
    <CameraDirector seat={previewSeat}/>
    <color attach="background" args={['#090f1b']}/><ambientLight intensity={1.35}/><directionalLight position={[-6,15,4]} intensity={2.5} castShadow/><pointLight position={[0,4,-9]} intensity={22} color="#577fd8" distance={20}/>
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.02,0]} receiveShadow><planeGeometry args={[22,27]}/><meshStandardMaterial color="#141c2b" roughness={.9}/></mesh>
    <mesh position={[0,4,-10]}><boxGeometry args={[16,7,.18]}/><meshStandardMaterial color="#0f1726"/></mesh>
    <mesh position={[0,4,-9.83]}><planeGeometry args={[14.9,6.1]}/><meshStandardMaterial emissive="#dae5ff" emissiveIntensity={.8} color="#91a9dd" toneMapped={false}/></mesh>
    <Text position={[0,4,-9.7]} fontSize={1} color="#18264d">RAINY CINEMA</Text>
    <mesh position={[-9,1,0]}><boxGeometry args={[.25,3,25]}/><meshStandardMaterial color="#1b2637"/></mesh><mesh position={[9,1,0]}><boxGeometry args={[.25,3,25]}/><meshStandardMaterial color="#1b2637"/></mesh>
    {seats.map(seat => <Seat3D key={seat.id} seat={seat} selected={selected} onClick={onClick}/>)}
    <OrbitControls makeDefault enabled={!previewSeat} minDistance={4} maxDistance={34} maxPolarAngle={Math.PI/2.08} minPolarAngle={.12} enableDamping target={[0,0,-1]} />
    {previewSeat && <group position={[previewSeat.x,1.3,previewSeat.z]}><mesh><sphereGeometry args={[.1,12,12]}/><meshBasicMaterial color="#37dca5"/></mesh></group>}
  </Canvas>;
}
function App() {
  const [locale,setLocale]=useState('mn'), [mode,setMode]=useState('3d'), [selected,setSelected]=useState([]), [preview,setPreview]=useState(null), [message,setMessage]=useState('');
  const seats=useMemo(makeSeatMap,[]), t=labels[locale], chosenSeat=seats.find(s=>s.id===preview);
  const onSeat=seat => { if(seat.status!=='available') { setMessage(locale==='mn'?'Энэ суудал сонгох боломжгүй.':'This seat is unavailable.'); return; } setSelected(old=>toggleSeat(old,seat)); setMessage(''); };
  return <div className="app"><header className="header"><div className="brand"><span className="brand-icon">◈</span> RAINY <strong>CINEMA</strong><span className="brand-3d">3D</span></div><div className="head-right"><span className="demo-tag">● {t.demo}</span><button className="language" onClick={()=>setLocale(locale==='mn'?'en':'mn')}>{locale==='mn'?'EN':'MN'}</button></div></header>
    <main><section className="intro"><div className="eyebrow">THE NEXT GENERATION OF CINEMA EXPERIENCE</div><h1>{t.title}<span className="dot">.</span></h1><p>{t.subtitle}</p><div className="meta"><span>◉ {t.hall}</span><span>◷ 19:30</span><span>✧ Dolby Atmos · Demo</span></div></section>
      <div className="workspace"><section className="theatre"><div className="toolbar"><div className="section-title"><span className="live-dot"/> {t.select}</div><div className="switch"><button className={mode==='3d'?'active':''} onClick={()=>setMode('3d')}>◈ {t.preview}</button><button className={mode==='2d'?'active':''} onClick={()=>setMode('2d')}>▦ {t.twoD}</button></div></div>
      <div className="scene">{mode==='3d'?<HallScene seats={seats} selected={selected} onClick={onSeat} previewSeat={chosenSeat} fallbackText={locale==='mn'?'3D харагдац боломжгүй байна. 2D зураглалыг ашиглана уу.':'3D is unavailable. Please use the 2D map.'}/>:<div className="flat-scene"><div className="screen-2d">{t.screen}</div><div className="rows">{'ABCDEFGH'.split('').map(row=><div className="flat-row" key={row}><span className="row-id">{row}</span>{seats.filter(s=>s.row===row).map(s=><button aria-label={`${s.id} ${s.status}`} aria-pressed={selected.includes(s.id)} disabled={s.status!=='available'} title={s.id} key={s.id} onClick={()=>onSeat(s)} className={'flat-seat '+ (selected.includes(s.id)?'picked ':s.status==='sold'?'sold ':s.status==='held'?'held ':s.type==='vip'?'vip ':'')}>{s.col}</button>)}</div>)}</div></div>}</div>
      <div className="legend"><span><i className="legend-icon available"/>{t.available}</span><span><i className="legend-icon selected"/>{t.selected}</span><span><i className="legend-icon vip"/>{t.vip}</span><span><i className="legend-icon held"/>{t.held}</span><span><i className="legend-icon sold"/>{t.sold}</span></div></section>
      <aside className="sidebar"><div className="sidebar-top"><div className="pill">01 / DEMO CINEMA</div><h2>{t.choose}</h2><p>{t.notice}</p></div><div className="divider"/><div className="label">{t.seats} <span>{selected.length} / 6</span></div><div className="chips">{selected.length?selected.map(id=><button className="seat-chip" key={id} onClick={()=>setSelected(s=>s.filter(v=>v!==id))}>{id} ×</button>):<div className="empty">{locale==='mn'?'Одоогоор сонгоогүй байна':'No seats selected'}</div>}</div><div className="seat-details">{selected.map(id=>{const s=seats.find(v=>v.id===id);return <div className="detail" key={id}><span>{id} · {s.type==='vip'?t.vip:t.standard}</span><strong>{fmt(s.price)}</strong><button onClick={()=>{setMode('3d');setPreview(id)}}>{t.view} ↗</button></div>})}</div>{preview&&<button className="back" onClick={()=>setPreview(null)}>← {t.back} ({preview})</button>}<div className="spacer"/><div className="total"><span>{t.price}</span><strong>{fmt(totalPrice(seats,selected))}</strong></div><button className="checkout" disabled={!selected.length} onClick={()=>setMessage(t.status)}>{t.continue} →</button><button className="clear" disabled={!selected.length} onClick={()=>{setSelected([]);setPreview(null);setMessage('')}}>{t.reset}</button>{message&&<div className="message" role="status">{message}</div>}<p className="warning">⚠ {t.status}</p></aside></div>
      <footer>© 2026 RAINY CINEMA 3D <span>DEMONSTRATION · NO LIVE TICKETING INTEGRATION</span></footer>
    </main></div>;
}
createRoot(document.getElementById('root')).render(<App/>);
