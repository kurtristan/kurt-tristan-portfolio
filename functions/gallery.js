const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // GET - Fetch all gallery items
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('gallery')
        .select('*')
        .order('order_index', { ascending: true });

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(data)
      };
    }

    // POST - Add new gallery item
    if (event.httpMethod === 'POST') {
      const { filename, location, image_url } = JSON.parse(event.body);
      
      // Get next order index
      const { data: maxOrder } = await supabase
        .from('gallery')
        .select('order_index')
        .order('order_index', { ascending: false })
        .limit(1);
      
      const nextOrder = maxOrder.length > 0 ? maxOrder[0].order_index + 1 : 1;

      const { data, error } = await supabase
        .from('gallery')
        .insert([{
          filename,
          location,
          image_url: image_url || `photos/${filename}`,
          order_index: nextOrder
        }])
        .select();

      if (error) throw error;

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify(data[0])
      };
    }

    // PUT - Update gallery item
    if (event.httpMethod === 'PUT') {
      const { id, location } = JSON.parse(event.body);
      
      const { data, error } = await supabase
        .from('gallery')
        .update({ location })
        .eq('id', id)
        .select();

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(data[0])
      };
    }

    // DELETE - Remove gallery item
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body);
      
      const { error } = await supabase
        .from('gallery')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
