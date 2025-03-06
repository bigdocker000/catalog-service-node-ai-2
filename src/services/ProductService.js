const { Client } = require("pg");

const { getInventoryForProduct } = require("./InventoryService");
const { uploadFile, getFile } = require("./StorageService");
const { publishEvent } = require("./PublisherService");
const productGenerator = require("./ProductGenerator");

let client;
async function getClient() {
  if (!client) {
    // Configured using environment variables
    client = new Client();
    await client.connect();
  }
  return client;
}

async function teardown() {
  if (client) {
    await client.end();
  }
}

async function getProducts() {
  const client = await getClient();

  const result = await client.query("SELECT * FROM products ORDER BY id ASC");

  return result.rows;
}

async function createProduct(product) {
  console.time("createProduct");
  const client = await getClient();

  const existingProduct = await client.query(
    "SELECT * FROM products WHERE upc = $1",
    [product.upc],
  );

  if (existingProduct.rows.length > 0)
    throw new Error("Product with this UPC already exists");

  console.time("createProduct:dbInsert");
  const result = await client.query(
    "INSERT INTO products (name, description, category, upc, price) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [
      product.name,
      product.description,
      product.category,
      product.upc,
      product.price || null,
    ],
  );
  console.timeEnd("createProduct:dbInsert");

  const newProductId = result.rows[0].id;

  console.time("createProduct:publishEvent");
  publishEvent("products", {
    action: "product_created",
    id: newProductId,
    name: product.name,
    description: product.description,
    category: product.category,
    price: product.price,
    upc: product.upc,
  });
  console.timeEnd("createProduct:publishEvent");

  console.timeEnd("createProduct");
  return {
    ...product,
    id: newProductId,
  };
}

async function getProductById(id) {
  const client = await getClient();

  const result = await client.query("SELECT * FROM products WHERE id = $1", [
    id,
  ]);

  if (result.rows.length === 0) {
    return null;
  }

  const product = result.rows[0];

  const inventory = await getInventoryForProduct(product.upc);

  return {
    inventory,
    ...product,
  };
}

async function getProductImage(id) {
  return getFile(id);
}

async function uploadProductImage(id, buffer) {
  const client = await getClient();

  await uploadFile(id, buffer);
  await client.query("UPDATE products SET has_image=TRUE WHERE id=$1", [id]);
}

async function deleteProduct(id) {
  const client = await getClient();

  // First check if the product exists
  const checkResult = await client.query(
    "SELECT * FROM products WHERE id = $1",
    [id],
  );

  if (checkResult.rows.length === 0) {
    return false;
  }

  const product = checkResult.rows[0];

  try {
    // Start a transaction
    await client.query("BEGIN");

    // Delete any recommendations where this product is the source
    await client.query(
      "DELETE FROM saved_recommendations WHERE source_product_id = $1",
      [id],
    );

    // Delete any recommendations where this product is the recommended product
    await client.query(
      "DELETE FROM saved_recommendations WHERE recommended_product_id = $1",
      [id],
    );

    // Delete the product
    await client.query("DELETE FROM products WHERE id = $1", [id]);

    // Commit the transaction
    await client.query("COMMIT");

    // Publish an event about the deletion
    publishEvent("products", {
      action: "product_deleted",
      id: id,
      name: product.name,
      upc: product.upc,
    });

    return true;
  } catch (error) {
    // Rollback in case of error
    await client.query("ROLLBACK");
    console.error("Error in deleteProduct transaction:", error);
    throw error;
  }
}

async function generateRandomProduct() {
  console.time("generateRandomProduct");
  const product = await productGenerator.generateRandomProduct();
  console.timeEnd("generateRandomProduct");
  return product;
}

module.exports = {
  getProducts,
  createProduct,
  getProductById,
  getProductImage,
  uploadProductImage,
  deleteProduct,
  generateRandomProduct,
  teardown,
};
