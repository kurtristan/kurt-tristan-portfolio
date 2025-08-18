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
    // GET - Fetch all journal entries
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('journal')
        .select('*')
        .order('entry_date', { ascending: false });

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(data)
      };
    }

    // POST - Add new journal entry
    if (event.httpMethod === 'POST') {
      const { title, content, entry_date } = JSON.parse(event.body);
      
      const { data, error } = await supabase
        .from('journal')
        .insert([{
          title,
          content,
          entry_date
        }])
        .select();

      if (error) throw error;

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify(data[0])
      };
    }

    // PUT - Update journal entry
    if (event.httpMethod === 'PUT') {
      const { id, title, content, entry_date } = JSON.parse(event.body);
      
      const { data, error } = await supabase
        .from('journal')
        .update({ title, content, entry_date })
        .eq('id', id)
        .select();

      if (error) throw error;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(data[0])
      };
    }

    // DELETE - Remove journal entry
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body);
      
      const { error } = await supabase
        .from('journal')
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
