const BUCKET = 'circuito-previews';

/**
 * Sube una imagen al bucket de Supabase Storage y devuelve su URL pública.
 * Usa la API REST de Storage directo con fetch (Node 18+ ya lo trae
 * incorporado), autenticando con la service_role key -- por eso esto
 * SOLO debe llamarse desde el backend, nunca exponer esa key al cliente.
 *
 * Requiere las variables de entorno SUPABASE_URL y SUPABASE_SERVICE_KEY.
 */
async function subirImagenCircuito(circuitoId, buffer) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en las variables de entorno');
  }

  const path = `${circuitoId}.png`;
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${BUCKET}/${path}`;

  const resp = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: buffer,
  });

  if (!resp.ok) {
    const texto = await resp.text().catch(() => '');
    throw new Error(`Error subiendo a Supabase Storage (${resp.status}): ${texto}`);
  }

  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`;
}

module.exports = { subirImagenCircuito };
