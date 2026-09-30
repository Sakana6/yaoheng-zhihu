import type { Occurrence } from './care';
export interface NotificationAdapter {
  clear(): Promise<void>;
  schedule(items:Array<{id:number; occurrence:Occurrence}>):Promise<void>;
}
/** One serial owner prevents delayed schedule calls from resurrecting a logged-out session. */
export class NotificationQueue {
  private queue:Promise<void>=Promise.resolve();
  private generation=0;
  constructor(private adapter:NotificationAdapter){}
  sync(items:Occurrence[], enabled:boolean){
    const generation=++this.generation;
    this.queue=this.queue.catch(()=>{}).then(async()=>{
      await this.adapter.clear();
      if(generation!==this.generation||!enabled)return;
      const active=items.filter(x=>x.executionStatus==='PENDING'&&Date.parse(x.plannedAt)>Date.now());
      // IDs are a bijection for this reconciled batch; server occurrenceId is preserved in notification extra.
      await this.adapter.schedule(active.map((occurrence,i)=>({id:710000+i,occurrence})));
      if(generation!==this.generation)await this.adapter.clear();
    });
    return this.queue;
  }
  stop(){return this.sync([],false);}
}
