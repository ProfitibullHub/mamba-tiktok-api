import axios from 'axios';

async function testProductsEndpoint() {
    try {
        // Get account ID from environment or use a test value
        const accountId = '3c5e7c6a-7b8a-4f9e-8d1c-2a3b4c5d6e7f'; // Replace with actual

        const response = await axios.get(`http://localhost:3001/api/tiktok-shop/products/synced/${accountId}`);

        console.log('Products Response:');
        console.log(JSON.stringify(response.data, null, 2));

        if (response.data.data?.products) {
            const products = response.data.data.products;
            console.log(`\nFound ${products.length} products`);

            products.slice(0, 3).forEach((p: any) => {
                console.log(`\n- ${p.product_name} (${p.product_id})`);
                console.log(`  GMV: ${p.gmv}, Orders: ${p.orders_count}, CTR: ${p.click_through_rate}`);
                console.log(`  Images: ${p.images?.length || 0}, Main Image: ${p.main_image_url ? 'YES' : 'NO'}`);
                console.log(`  Details: ${p.details ? 'YES' : 'NO'}`);
            });
        }
    } catch (error: any) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
    }
}

testProductsEndpoint();
