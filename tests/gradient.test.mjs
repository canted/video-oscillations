import test from 'node:test';
import assert from 'node:assert/strict';
import { gradientModel, sampleGradient, stopColor } from '../gradient.mjs';
const stops = positions => positions.map((position, i) => ({position, color: ['#ff0000','#00ff00','#0000ff'][i], shade:50}));
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-10, `${a} != ${b}`);
test('equally spaced endpoints receive equal stripes', () => {
  const model = gradientModel(stops([0,50,100]),1);
  near(model.starts[0],1/3); near(model.starts[1],2/3);
  assert.deepEqual(model.starts,model.ends);
});
test('uneven positions produce the agreed 20:50:80 widths', () => {
  const model = gradientModel(stops([0,20,100]),1);
  near(model.starts[0],20/150); near(model.starts[1],70/150);
  assert.deepEqual(sampleGradient(model,.1),[1,0,0]);
  assert.deepEqual(sampleGradient(model,.3),[0,1,0]);
  assert.deepEqual(sampleGradient(model,.8),[0,0,1]);
});
test('smooth mode preserves chosen stop positions and 1:4 gap ratio', () => {
  const model = gradientModel(stops([0,20,100]),0);
  assert.deepEqual(sampleGradient(model,0),[1,0,0]);
  assert.deepEqual(sampleGradient(model,.2),[0,1,0]);
  assert.deepEqual(sampleGradient(model,1),[0,0,1]);
  near((model.ends[1]-model.starts[1])/(model.ends[0]-model.starts[0]),4);
});
test('every intermediate stepping has eased nonzero blends and constant plateaus', () => {
  for (const s of [.01,.5,.99,.99999]) {
    const m=gradientModel(stops([0,20,100]),s);
    m.starts.forEach((start,i)=>{
      assert.ok(m.ends[i]>start);
      const eps=(m.ends[i]-start)*1e-5;
      const c=sampleGradient(m,start+eps);
      c.forEach((v,j)=>assert.ok(Math.abs(v-m.colors[i][j])<1e-8));
    });
    const middle=(m.ends[0]+m.starts[1])/2;
    assert.deepEqual(sampleGradient(m,middle),[0,1,0]);
  }
});
test('shade endpoints and midpoint remain exact', () => {
  assert.deepEqual(stopColor({color:'#db4275',shade:0}),[0,0,0]);
  assert.deepEqual(stopColor({color:'#db4275',shade:50}),[219/255,66/255,117/255]);
  assert.deepEqual(stopColor({color:'#db4275',shade:100}),[1,1,1]);
});
test('two stops and moved endpoints stay finite throughout stepping',()=>{
  for(const positions of [[0,100],[20,80],[30,30.1]])for(const s of [0,.5,1]){
    const m=gradientModel(stops(positions),s);
    for(const x of [0,.25,.5,.75,1]) assert.ok(sampleGradient(m,x).every(Number.isFinite));

  }
});

test('moving the first of two stops to 90 or 99 preserves its long color tail', () => {
  for (const position of [90,99]) for (const stepping of [0,.5,.99,1]) {
    const model = gradientModel(stops([position,100]),stepping);
    assert.ok(model.starts[0] >= position/100 - .001);
    assert.deepEqual(sampleGradient(model,.89),[1,0,0]);
    assert.deepEqual(sampleGradient(model,1),[0,1,0]);
  }
});
test('moving the last stop inward preserves the right color tail', () => {
  for (const stepping of [0,.5,1]) {
    const model = gradientModel(stops([0,10]),stepping);
    assert.ok(model.ends[0] < .11);
    assert.deepEqual(sampleGradient(model,.11),[0,1,0]);
  }
});
