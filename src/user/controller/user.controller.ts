import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Post,
    Put
} from '@nestjs/common';
import { ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthJwtGuard } from '@authentication/decorator/authentication.decorator';
import { GetUser } from '@authentication/decorator/get-user.decorator';
import { Permission } from '@authentication/decorator/permission.decorator';
import { HelperPermissionService } from '@helper/service/helper.permissions.service';
import { EMAIL_TEMPLATES, PERMISSIONS } from '@warlock/shared';
import { UserDocument, UserEntity } from '@user/schema/user.schema';
import { UserService } from '@user/service/user.service';
import { UpdateUserRequestDTO } from '@user/dto/update-user-request.dto';
import { OnboardUserRequestDTO } from '@user/dto/onboard-user-request.dto';

@Controller({
    version: '1',
    path: 'user'
})
@ApiTags('User')
export class UserController {
    public constructor(
        private readonly userService: UserService,
        private readonly helperPermissionService: HelperPermissionService
    ) {}

    @Put('/onboard')
    @AuthJwtGuard()
    @ApiResponse({ type: UserEntity })
    public async onboard(
        @GetUser() user: UserDocument,
        @Body() onboardUserRequest: OnboardUserRequestDTO
    ): Promise<UserDocument> {
        const { _id: userId } = user;
        await this.userService.update(userId, onboardUserRequest);

        await this.userService.sendEmail(
            userId,
            onboardUserRequest.email,
            EMAIL_TEMPLATES.onboardEmail
        );

        return this.userService.addPermission(userId, PERMISSIONS.ONBOARDED);
    }

    @AuthJwtGuard()
    @ApiResponse({ type: Boolean })
    @Get('/is-onboarded')
    public isOnboarded(@GetUser() user: UserDocument): boolean {
        return this.helperPermissionService.isOnboarded(user.permissions);
    }

    @AuthJwtGuard()
    @Post('/resend')
    public async resendEmailVerification(
        @GetUser() user: UserDocument
    ): Promise<void> {
        await this.userService.sendEmail(
            user._id,
            user.email,
            EMAIL_TEMPLATES.verifyEmail
        );
    }

    @AuthJwtGuard()
    @Put('/')
    @ApiResponse({ type: UserEntity })
    public async update(
        @GetUser('_id') userId: string,
        @Body() body: UpdateUserRequestDTO
    ): Promise<UserDocument> {
        if (body.favoriteWalletAddresses) {
            const user = await this.userService.getUserWithTags(userId);
            const userTags = new Set(user.tags.map(t => t._id.toString()));
            const addresses = new Set();
            body.favoriteWalletAddresses = body.favoriteWalletAddresses.map(
                favorite => {
                    const tags = new Set();
                    const { invalidTags, duplicateTags } = favorite.tags.reduce(
                        ({ invalidTags, duplicateTags }, tag) => {
                            if (tags.has(tag)) {
                                duplicateTags.push(tag);
                            } else {
                                tags.add(tag);
                                if (!userTags.has(tag)) {
                                    invalidTags.push(tag);
                                }
                            }
                            return { invalidTags, duplicateTags };
                        },
                        { invalidTags: [], duplicateTags: [] }
                    );

                    if (invalidTags.length || duplicateTags.length) {
                        throw new BadRequestException({
                            message: [
                                ...(invalidTags || []).map(
                                    invalidTag =>
                                        `favoriteWalletAddresses contains invalid tag: "${invalidTag}"`
                                ),
                                ...(duplicateTags || []).map(
                                    invalidTag =>
                                        `favoriteWalletAddresses contains duplicate tag: "${invalidTag}"`
                                )
                            ],

                            error: 'Bad Request'
                        });
                    }

                    if (addresses.has(favorite.walletAddress)) {
                        throw new BadRequestException({
                            message: [
                                `favoriteWalletAddresses contains duplicate address: "${favorite.walletAddress}"`
                            ],
                            error: 'Bad Request'
                        });
                    }
                    addresses.add(favorite.walletAddress);
                    return favorite;
                }
            );
        }
        return this.userService.formatAndUpdate(userId, body);
    }

    @Get('/')
    @AuthJwtGuard()
    @Permission('email:verified')
    @Permission('access:studio')
    @ApiResponse({ type: UserEntity })
    public async findOne(@GetUser() user: UserDocument): Promise<UserDocument> {
        return user;
    }
}
