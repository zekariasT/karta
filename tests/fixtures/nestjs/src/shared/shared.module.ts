import { Module } from "@nestjs/common";

class SharedService {}

@Module({
  providers: [SharedService],
  exports: [SharedService],
})
export class SharedModule {}
