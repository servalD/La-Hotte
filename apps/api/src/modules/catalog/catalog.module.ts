import { Module } from '@nestjs/common';
import { PrivateImages } from './application/private-images';
import {
  CreateProduct,
  GetImage,
  GetOwnProduct,
  ListOwnProducts,
  ProductCatalog,
  UpdateProduct,
} from './application/manage-products.use-case';
import {
  CreateProductFromLink,
  CreateProductFromPhoto,
  FailStaleExtractions,
  RunExtraction,
} from './application/extract-product.use-case';
import {
  ExtractionCache,
  ExtractionQueue,
  PageAnalyzer,
  ProductExtractor,
} from './domain/extraction.ports';
import { PageFetcher } from './domain/page-fetcher.port';
import { ClaudeProductExtractor } from './infrastructure/claude-product-extractor';
import {
  InProcessExtractionQueue,
  PrismaExtractionCache,
} from './infrastructure/extraction-adapters';
import { HtmlPageAnalyzer } from './infrastructure/html-page-analyzer';
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
    PrivateImages,
    { provide: ProductRepository, useClass: PrismaProductRepository },
    { provide: ImageStore, useClass: DiskImageStore },
    { provide: PageFetcher, useClass: HttpPageFetcher },
    CreateProductFromLink,
    CreateProductFromPhoto,
    RunExtraction,
    FailStaleExtractions,
    { provide: PageAnalyzer, useClass: HtmlPageAnalyzer },
    { provide: ProductExtractor, useClass: ClaudeProductExtractor },
    { provide: ExtractionCache, useClass: PrismaExtractionCache },
    { provide: ExtractionQueue, useClass: InProcessExtractionQueue },
  ],
  exports: [ProductCatalog, PrivateImages],
})
export class CatalogModule {}
