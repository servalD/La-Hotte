// Ce que la présentation peut connaître du module (QA-03).
export {
  PRICE_MINOR_MAX,
  type Product,
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_MERCHANT_MAX,
  PRODUCT_TITLE_MAX,
  PRODUCT_URL_MAX,
} from '../domain/product';
export {
  CreateProduct,
  GetImage,
  GetOwnProduct,
  ListOwnProducts,
  UpdateProduct,
} from './manage-products.use-case';
