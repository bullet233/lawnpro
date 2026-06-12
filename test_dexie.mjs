import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Go to localhost
  await page.goto('http://localhost:5173');
  
  // Wait for React to mount
  await page.waitForSelector('.app-container', { timeout: 10000 });

  // Expose a method to run code in the page context
  const result = await page.evaluate(async () => {
    return new Promise(async (resolve) => {
      try {
        const { db } = await import('/src/db/db.js');
        
        // Add a customer "from the field"
        const newCustomer = {
          name: "Test Field Add",
          address: 'Added from field', 
          phone: '',
          email: '',
          propertyNotes: '',
          geofence: [
            { lat: 30.0001, lng: -90.0001 },
            { lat: 30.0001, lng: -89.9999 },
            { lat: 29.9999, lng: -89.9999 },
            { lat: 29.9999, lng: -90.0001 }
          ],
          services: [
            { id: "some-uuid-1234", name: 'Mowing', price: 40, active: true },
          ],
          createdAt: Date.now()
        };
        
        const id = await db.customers.add(newCustomer);
        
        // Now simulate CustomerDetail saving
        const dataToSave = {
          name: "Test Field Add Updated",
          address: 'Added from field', 
          phone: '',
          email: '',
          propertyNotes: '',
          geofence: newCustomer.geofence,
          services: newCustomer.services,
          // These are the defaults CustomerDetail adds
          lawnSize: '',
          obstacleCount: '',
          terrain: 'flat',
          fencedBackyard: false,
          serviceInterval: 7,
          mowingInterval: 7,
          fertilizerInterval: 30,
          fertilizerRounds: 6,
          specialApplications: ''
        };
        
        await db.customers.update(Number(id), dataToSave);
        
        const updated = await db.customers.get(id);
        
        resolve("Success: " + updated.name);
      } catch (e) {
        resolve("Error: " + e.message);
      }
    });
  });

  console.log("Result:", result);
  await browser.close();
})();
