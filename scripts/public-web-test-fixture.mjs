import { createProjectPublicationFixture, PRIVATE_MARKER } from './project-publication-test-fixture.mjs';
export { PRIVATE_MARKER };
export async function createPublicWebFixture() {
  const fixture = await createProjectPublicationFixture();
  fixture.tables.services = [false, true].map((published, index) => ({
    id: '00000000-0000-4000-8000-00000000010' + index, slug: published ? 'public-service' : 'private-service',
    title: published ? 'Servicio audiovisual ficticio' : PRIVATE_MARKER,
    title_en: published ? 'Synthetic audiovisual service' : PRIVATE_MARKER,
    description: published ? 'Descripción pública ficticia.' : PRIVATE_MARKER,
    description_en: published ? 'Synthetic public description.' : PRIVATE_MARKER,
    is_published: published, sort_order: index, icon: 'movie', highlighted: false,
    cta_message: 'Consulta ficticia de servicio', cta_message_en: 'Synthetic service question',
    tagline: 'Servicio para pruebas locales', tagline_en: 'Service for local tests',
    hero_description: 'Contenido editorial ficticio', hero_description_en: 'Synthetic editorial content',
    features: [{ title:'Pieza ficticia', description:'Descripción ficticia' }],
    features_en: [{ title:'Synthetic piece', description:'Synthetic description' }],
    process: [{ step:'1', title:'Brief ficticio', description:'Proceso ficticio' }],
    process_en: [{ step:'1', title:'Synthetic brief', description:'Synthetic process' }],
    internal_note: PRIVATE_MARKER,
  }));
  for (const project of fixture.tables.projects) {
    project.case_study = { brief:'Encargo ficticio aprobado', process:'Proceso ficticio aprobado', result:'Resultado ficticio aprobado', services:['Servicio ficticio'] };
    project.case_study_en = { brief:'Approved synthetic brief', process:'Approved synthetic process', result:'Approved synthetic result', services:['Synthetic service'] };
  }
  return fixture;
}

