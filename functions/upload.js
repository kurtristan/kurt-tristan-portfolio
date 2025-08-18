const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { image, filename, location } = JSON.parse(event.body);
    
    // Decode base64 image
    const imageBuffer = Buffer.from(image.split(',')[1], 'base64');
    
    // Generate unique filename
    const timestamp = Date.now();
    const fileExtension = filename.split('.').pop();
    const uniqueFilename = `gallery-${timestamp}.${fileExtension}`;
    
    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('photos')
      .upload(uniqueFilename, imageBuffer, {
        contentType: `image/${fileExtension}`,
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('photos')
      .getPublicUrl(uniqueFilename);

    // Add to gallery database
    const { data: galleryData, error: galleryError } = await supabase
      .from('gallery')
      .insert([{
        filename: uniqueFilename,
        location: location,
        image_url: urlData.publicUrl,
        order_index: timestamp
      }])
      .select();

    if (galleryError) throw galleryError;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        filename: uniqueFilename,
        url: urlData.publicUrl,
        gallery_item: galleryData[0]
      })
    };

  } catch (error) {
    console.error('Upload error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        success: false, 
        error: error.message 
      })
    };
  }
};
