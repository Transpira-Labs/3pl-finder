export type Locale = "en" | "es";

const translations = {
  // App shell
  "app.title": { en: "3PL Finder", es: "Buscador de 3PL" },
  "app.subtitle": { en: "Find logistics partners · Compare services", es: "Encuentra socios logísticos · Compara servicios" },
  "nav.discover": { en: "Discover 3PLs", es: "Descubrir 3PLs" },
  "nav.pipeline": { en: "Pipeline", es: "Pipeline" },
  "nav.lists": { en: "My Lists", es: "Mis Listas" },
  "nav.import": { en: "Import Leads", es: "Importar Contactos" },
  "nav.settings": { en: "Settings", es: "Configuración" },

  // Discovery page
  "discovery.title": { en: "Discover 3PLs", es: "Descubrir 3PLs" },
  "discovery.subtitle": {
    en: "Find third-party logistics companies, warehouses, and fulfillment centers in the Atlanta area.",
    es: "Encuentra empresas de logística, almacenes y centros de cumplimiento en el área de Atlanta.",
  },
  "discovery.search.placeholder": { en: "e.g. Atlanta, GA", es: "ej. Atlanta, GA" },
  "discovery.search.empty": {
    en: "Search for 3PL warehouses, fulfillment centers, and logistics companies",
    es: "Busca almacenes 3PL, centros de cumplimiento y empresas de logística",
  },
  "discovery.searching": { en: "Searching...", es: "Buscando..." },
  "discovery.noResults": {
    en: "No companies found. Try a different location or wider radius.",
    es: "No se encontraron empresas. Intenta otra ubicación o un radio más amplio.",
  },
  "discovery.storesFound": { en: "companies found", es: "empresas encontradas" },
  "discovery.add": { en: "Add", es: "Agregar" },
  "discovery.added": { en: "Added", es: "Agregado" },
  "discovery.addToPipeline": { en: "Add to Pipeline", es: "Agregar al Pipeline" },
  "discovery.inPipeline": { en: "In pipeline", es: "En pipeline" },
  "discovery.alreadyInPipeline": { en: "Already in pipeline", es: "Ya está en el pipeline" },
  "discovery.save": { en: "Save", es: "Guardar" },
  "discovery.saveSearch": { en: "Save Search", es: "Guardar Búsqueda" },
  "discovery.saveSearch.placeholder": { en: "e.g. Atlanta 25mi", es: "ej. Atlanta 25mi" },
  "discovery.retry": { en: "Retry", es: "Reintentar" },

  // Detail panel
  "detail.address": { en: "Address", es: "Dirección" },
  "detail.phone": { en: "Phone", es: "Teléfono" },
  "detail.hours": { en: "Hours", es: "Horario" },
  "detail.reviews": { en: "reviews", es: "reseñas" },

  // Pipeline page
  "pipeline.title": { en: "Pipeline", es: "Pipeline" },
  "pipeline.storesTracked": { en: "companies being tracked", es: "empresas en seguimiento" },
  "pipeline.searchStores": { en: "Search companies...", es: "Buscar empresas..." },
  "pipeline.all": { en: "All", es: "Todos" },
  "pipeline.selectStore": { en: "Select a company", es: "Selecciona una empresa" },
  "pipeline.selectStoreHint": {
    en: "Click a company from the list to see details and log activity",
    es: "Haz clic en una empresa de la lista para ver detalles y registrar actividad",
  },
  "pipeline.noStores": {
    en: "No companies yet. Discover 3PLs and add them to your pipeline.",
    es: "Aún no hay empresas. Descubre 3PLs y agrégalos a tu pipeline.",
  },
  "pipeline.noActivity": { en: "No activity yet", es: "Sin actividad aún" },
  "pipeline.noActivityHint": {
    en: "Contact this company and add a note about how it went",
    es: "Contacta esta empresa y agrega una nota sobre cómo fue",
  },
  "pipeline.stage": { en: "Stage", es: "Etapa" },
  "pipeline.call": { en: "Call", es: "Llamar" },
  "pipeline.addNote": { en: "Add Note", es: "Agregar Nota" },
  "pipeline.activity": { en: "Activity", es: "Actividad" },
  "pipeline.notePlaceholder": {
    en: "Add a note... (e.g. Called, discussed warehousing options)",
    es: "Agregar nota... (ej. Llamé, discutimos opciones de almacenamiento)",
  },
  "pipeline.save": { en: "Save", es: "Guardar" },
  "pipeline.loading": { en: "Loading...", es: "Cargando..." },

  // Stages
  "stage.new": { en: "New", es: "Nuevo" },
  "stage.contacted": { en: "Contacted", es: "Contactado" },
  "stage.follow_up": { en: "Follow Up", es: "Seguimiento" },
  "stage.qualified": { en: "Qualified", es: "Calificado" },
  "stage.won": { en: "Won", es: "Ganado" },
  "stage.lost": { en: "Lost", es: "Perdido" },
  "stage.do_not_contact": { en: "Do Not Contact", es: "No Contactar" },

  // Lists
  "lists.title": { en: "My Lists", es: "Mis Listas" },
  "lists.subtitle": {
    en: "Organize companies into named collections for comparison.",
    es: "Organiza empresas en colecciones con nombre para comparar.",
  },
  "lists.empty": {
    en: "No lists yet. Create one to start organizing companies.",
    es: "Aún no hay listas. Crea una para empezar a organizar empresas.",
  },
  "lists.create": { en: "New List", es: "Nueva Lista" },
  "lists.createTitle": { en: "Create List", es: "Crear Lista" },
  "lists.name": { en: "List name", es: "Nombre de lista" },
  "lists.namePlaceholder": { en: "e.g. Atlanta fulfillment centers", es: "ej. Centros de cumplimiento de Atlanta" },
  "lists.description": { en: "Description (optional)", es: "Descripcion (opcional)" },
  "lists.stores": { en: "companies", es: "empresas" },
  "lists.delete": { en: "Delete", es: "Eliminar" },
  "lists.deleteConfirm": {
    en: "Are you sure you want to delete this list?",
    es: "Estas seguro de que quieres eliminar esta lista?",
  },
  "lists.export": { en: "Export CSV", es: "Exportar CSV" },
  "lists.optimize": { en: "Optimize Route", es: "Optimizar Ruta" },
  "lists.optimizing": { en: "Optimizing...", es: "Optimizando..." },
  "lists.openInMaps": { en: "Open in Google Maps", es: "Abrir en Google Maps" },
  "lists.removeStore": { en: "Remove", es: "Eliminar" },
  "lists.noStores": {
    en: "No companies in this list yet. Add companies from the Discover page.",
    es: "Aún no hay empresas en esta lista. Agrega empresas desde la página Descubrir.",
  },
  "lists.saveToList": { en: "Save to List", es: "Guardar en Lista" },
  "lists.selectList": { en: "Select a list", es: "Selecciona una lista" },
  "lists.orCreateNew": { en: "or create new:", es: "o crea una nueva:" },
  "lists.saved": { en: "Saved!", es: "Guardado!" },
  "lists.routeOptimized": { en: "Route optimized!", es: "Ruta optimizada!" },

  // Time
  "time.justNow": { en: "just now", es: "ahora" },
  "time.mAgo": { en: "m ago", es: "m atrás" },
  "time.hAgo": { en: "h ago", es: "h atrás" },
  "time.dAgo": { en: "d ago", es: "d atrás" },
} as const;

export type TranslationKey = keyof typeof translations;

export function t(key: TranslationKey, locale: Locale): string {
  return translations[key]?.[locale] ?? key;
}

export default translations;
