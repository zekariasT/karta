import { Module } from "@nestjs/common";
import { SharedModule } from "../shared/shared.module";

class FeatureService {}

@Module({
  imports: [SharedModule],
  providers: [
    FeatureService,
    { provide: "TOKEN", useClass: FeatureService },
  ],
  exports: [FeatureService],
})
export class FeatureModule {}
