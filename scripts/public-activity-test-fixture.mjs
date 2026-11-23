// Authorized fictitious preview only. Not a migration/production seed.
export const ACTIVITY_DEMO_ID = '00000000-0000-4000-8000-000000000901';
export function configurePublicActivityFixture(fixture) {
  fixture.tables.projects.push({ id:ACTIVITY_DEMO_ID,slug:'demo-audiovisual',title:'DEMO · Producción audiovisual ficticia',
    type:'Demo audiovisual',category:'demo',status:'in_production',is_published:true,sort_order:0,
    public_description:'Ejemplo ficticio para explorar el hub. No representa un encargo ni trabajo entregado.',
    thumbnail:'/img/demo-audiovisual.svg',video_url:'',resolution:'1920x1080',aspect:'16:9',duration:'30s',
    description:'INTERNAL_ACTIVITY_CANARY',client_name:'PRIVATE_CLIENT_CANARY',client_id:null,
    case_study:{brief:'Demostración ficticia autorizada.',process:'Ejemplo de cómo conversar sobre un proyecto.',result:'Demo de la interfaz; sin resultados comerciales.',services:['Dirección','AI Generation']},
    case_study_en:{brief:'Authorized fictitious demonstration.',process:'Example of discussing a project.',result:'Interface demo; no commercial results.',services:['Direction','AI Generation']},
    created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z' });
  const editorial = (id,project_id,title,title_en,text,text_en,event_type,date) => ({id,project_id,text:'INTERNAL_ACTIVITY_CANARY',level:'mid',log_type:'info',source:'admin',is_active:true,
    public_title:title,public_title_en:title_en,public_text:text,public_text_en:text_en,public_event_type:event_type,public_occurred_at:date,is_published:true,public_revision:0,created_at:date});
  fixture.tables.feed_entries.push(editorial('00000000-0000-4000-8000-000000000902',ACTIVITY_DEMO_ID,'DEMO · Dirección visual','DEMO · Visual direction','Ejemplo ficticio: exploramos una dirección visual para una pieza audiovisual.','Fictitious example: exploring a visual direction for an audiovisual piece.','process','2026-01-01T09:00:00.000Z'));
  fixture.tables.studio_logs.push(editorial('00000000-0000-4000-8000-000000000903',ACTIVITY_DEMO_ID,'DEMO · Propuesta de montaje','DEMO · Editing proposal','Avance ficticio del proyecto de demostración. No indica una ejecución en directo.','Fictitious progress on the demonstration project. This is not a live execution.','milestone','2026-01-01T10:00:00.000Z'));
  fixture.tables.studio_logs.push(editorial('00000000-0000-4000-8000-000000000904',null,'Dirección humana. Producción con IA.','Human direction. AI production.','El estudio une criterio creativo humano, producción audiovisual y herramientas de IA.','The studio combines human creative judgment, audiovisual production and AI tools.','studio','2026-01-01T08:00:00.000Z'));
  return fixture;
}
