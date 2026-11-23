import { sbRequest, dashboardRows, DashboardStorageError } from './dashboard';
import type { JourneyTaskCounts } from './client-journey-contract';

export async function mapWithConcurrency<T,R>(rows:T[],limit:number,work:(row:T)=>Promise<R>):Promise<R[]> {
  const result:R[]=new Array(rows.length);let cursor=0;
  await Promise.all(Array.from({length:Math.min(limit,rows.length)},async()=>{
    for (;;) {const index=cursor++;if(index>=rows.length)return;result[index]=await work(rows[index]);}
  }));
  return result;
}

async function exactTaskCount(projectId:string, pending=false):Promise<number> {
  const result=await sbRequest(`project_tasks?select=id&project_id=eq.${projectId}${pending?'&status=in.(pending,in_progress)':''}&limit=1`,'GET',undefined,'count=exact');
  const rows=dashboardRows(result.data);const count=Number(result.headers.get('content-range')?.split('/')[1]);
  if (!Number.isSafeInteger(count) || count<rows.length || count<0) throw new DashboardStorageError();
  return count;
}
export async function journeyTaskCounts(projectId:string):Promise<JourneyTaskCounts> {
  const [tasks_total,tasks_pending]=await Promise.all([exactTaskCount(projectId),exactTaskCount(projectId,true)]);
  if(tasks_pending>tasks_total)throw new DashboardStorageError();
  return {tasks_total,tasks_pending,tasks_completed:tasks_total-tasks_pending};
}
