/** Sequential software replay: pause takes effect after the in-flight event settles. */
export function createDeviceReplay<T>(send:(event:object)=>Promise<T>,result:(index:number,value:T|Error)=>void){
  let paused=true,busy=false,cursor=0,events:object[]=[];
  return {
    load(input:object[]){if(busy)throw Error('请先等待当前报文完成');if(input.length>100)throw Error('单次回放最多 100 条');events=input;cursor=0;paused=true;},
    pause(){paused=true;},
    get busy(){return busy;},get cursor(){return cursor;},get total(){return events.length;},
    async resume(){if(busy)return;paused=false;busy=true;try{while(!paused&&cursor<events.length){const index=cursor++;try{result(index,await send(events[index]!));}catch(e){result(index,e instanceof Error?e:Error(String(e)));}}}finally{busy=false;}},
  };
}
