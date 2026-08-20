/**
 * Sube un archivo a un bucket de Supabase Storage y devuelve su URL
 * pública. Usa la API REST de Storage directo con fetch (Node 18+ ya
 * lo trae incorporado), autenticando con la service_role key -- por
 * eso esto SOLO debe llamarse desde el backend, nunca exponer esa key
 * al cliente.
 *
 * Requiere las variables de entorno SUPABASE_URL y SUPABASE_SERVICE_KEY.
 */
async function subirArchivo(bucket, path, buffer, contentType) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en las variables de entorno');
  }

  const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${path}`;

  const resp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: buffer,
  });

  if (!resp.ok) {
    const texto = await resp.text().catch(() => '');
    throw new Error(`Error subiendo a Supabase Storage (${resp.status}): ${texto}`);
  }

  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${path}`;
}

/** Guarda un objeto inmutable en un bucket privado. */
async function subirArchivoPrivado(bucket, path, buffer, contentType) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en las variables de entorno');
  }

  const resp = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': contentType,
      'x-upsert': 'false',
    },
    body: buffer,
  });
  if (!resp.ok) {
    const texto = await resp.text().catch(() => '');
    throw new Error(`Error subiendo a Supabase Storage (${resp.status}): ${texto}`);
  }
}

/** Lee un objeto privado. La autorización de piloto ocurre en la ruta antes de llamarlo. */
async function descargarArchivoPrivado(bucket, path) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en las variables de entorno');
  }
  const resp = await fetch(`${supabaseUrl}/storage/v1/object/authenticated/${bucket}/${path}`, {
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
  });
  if (!resp.ok) {
    const texto = await resp.text().catch(() => '');
    throw new Error(`Error descargando de Supabase Storage (${resp.status}): ${texto}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

async function subirImagenCircuito(circuitoId, buffer) {
  return subirArchivo('circuito-previews', `${circuitoId}.png`, buffer, 'image/png');
}

async function subirImagenAuto(autoId, buffer) {
  return subirArchivo('auto-previews', `${autoId}.jpg`, buffer, 'image/jpeg');
}

module.exports = {
  subirArchivo,
  subirArchivoPrivado,
  descargarArchivoPrivado,
  subirImagenCircuito,
  subirImagenAuto,
};
