use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};

declare_id!("5oB6pCT1QfSNykDaG41KiUHqW3AVVMjfk6QMhyXc7Sm");

#[program]
pub mod anchor_bencher {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        // msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
    pub fn test(ctx: Context<Test>) -> Result<()> {
        msg!("User key: {:?}", ctx.accounts.user.key());
        Ok(())
    }
    pub fn test_with_cpi(ctx: Context<CreateUser>) -> Result<()> {
        ctx.accounts.user_account.name = "John".to_string();
        ctx.accounts.user_account.age = 30;
        Ok(())
    }
    pub fn test_with_error(ctx: Context<CreateUser>) -> Result<()> {
        err!(MyError::SomeError)
    }
}

#[derive(Accounts)]
pub struct Initialize {}

#[derive(Accounts)]
pub struct Test<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub user: Signer<'info>,
    // pub user: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CreateUser<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = 8 + User::INIT_SPACE
    )]
    pub user_account: Account<'info, User>,

    #[account(
        init,
        payer = user,
        mint::decimals = 9,
        mint::authority = user,
        mint::freeze_authority = user
    )]
    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(Default, InitSpace)]
pub struct User {
    #[max_len(100)]
    pub name: String,
    pub age: u8,
}

#[error_code]
pub enum MyError {
    SomeError
}
