import { Module } from "@nestjs/common";
import { SharedModule } from "./shared/shared.module";
import { FeatureModule } from "./feature/feature.module";

@Module({
  imports: [SharedModule, FeatureModule],
})
export class AppModule {}
