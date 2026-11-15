import { Module } from '@nestjs/common';
import {
  CreateProduct,
  GetImage,
  GetOwnProduct,
  ListOwnProducts,
  ProductCatalog,
  UpdateProduct,
} from './application/manage-products.use-case';
import { PageFetcher } from './domain/page-fetcher.port';
import { ImageStore, ProductRepository } from './domain/product.ports';
import { HttpPageFetcher } from './infrastructure/http-page-fetcher';
import { DiskImageStore } from './infrastructure/disk-image-store';
import { PrismaProductRepository } from './infrastructure/prisma-product-repository';
import { ImagesController, ProductsController } from './presentation/products.controller';

/** Module `catalog` : fiches article (ART-01 à ART-06) et images (EXT-47). */
@Module({
  controllers: [ProductsController, ImagesController],
  providers: [
    CreateProduct,
    GetOwnProduct,
    ListOwnProducts,
    UpdateProduct,
    GetImage,
    ProductCatalog,
    { provide: ProductRepository, useClass: PrismaProductRepository },
    { provide: ImageStore, useClass: DiskImageStore },
    { provide: PageFetcher, useClass: HttpPageFetcher },
  ],
  exports: [ProductCatalog],
})
export class CatalogModule {}
