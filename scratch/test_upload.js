const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

async function testUpload() {
  try {
    // Create a dummy image file for testing
    const dummyPath = path.join(__dirname, 'dummy.png');
    fs.writeFileSync(dummyPath, 'fake-image-content-here');

    const form = new FormData();
    form.append('image', fs.createReadStream(dummyPath));

    console.log('Sending post request to http://localhost:5001/api/upload?type=logos...');
    const res = await axios.post('http://localhost:5001/api/upload?type=logos', form, {
      headers: form.getHeaders()
    });

    console.log('Success:', res.data);
    fs.unlinkSync(dummyPath);
  } catch (error) {
    if (error.response) {
      console.log('Error status:', error.response.status);
      console.log('Error data:', error.response.data);
    } else {
      console.log('Error message:', error.message);
    }
  }
}

testUpload();
