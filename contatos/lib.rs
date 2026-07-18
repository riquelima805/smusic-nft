use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("2xaB1ZpMHpK1h44W7ogHtU3cng5bKtzfg6DHQMF9ELj2");

#[program]
pub mod adla_market {
    use super::*;

    
    pub fn list(ctx: Context<ListNft>, price: u64) -> Result<()> {
        require!(price > 0, MarketError::InvalidPrice);

        
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.seller_nft_account.to_account_info(),
                    to: ctx.accounts.vault_nft_account.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            1,
        )?;

        let listing = &mut ctx.accounts.listing;
        listing.seller = ctx.accounts.seller.key();
        listing.nft_mint = ctx.accounts.nft_mint.key();
        listing.price = price;
        listing.active = true;
        listing.bump = ctx.bumps.listing;

        Ok(())
    }

    
    pub fn unlist(ctx: Context<Unlist>) -> Result<()> {
        require!(ctx.accounts.listing.active, MarketError::NotListed);
        require_keys_eq!(ctx.accounts.listing.seller, ctx.accounts.seller.key(), MarketError::NotOwner);

        let seeds = listing_signer_seeds!(ctx.accounts.listing);
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_nft_account.to_account_info(),
                    to: ctx.accounts.seller_nft_account.to_account_info(),
                    authority: ctx.accounts.listing.to_account_info(),
                },
                &[&seeds[..]],
            ),
            1,
        )?;

        ctx.accounts.listing.active = false;
        Ok(())
    }

    
    pub fn buy(ctx: Context<Buy>) -> Result<()> {
        require!(ctx.accounts.listing.active, MarketError::NotListed);
        let price = ctx.accounts.listing.price;

        
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_payment_account.to_account_info(),
                    to: ctx.accounts.seller_payment_account.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            price,
        )?;

        
        let seeds = listing_signer_seeds!(ctx.accounts.listing);
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_nft_account.to_account_info(),
                    to: ctx.accounts.buyer_nft_account.to_account_info(),
                    authority: ctx.accounts.listing.to_account_info(),
                },
                &[&seeds[..]],
            ),
            1,
        )?;

        ctx.accounts.listing.active = false;
        Ok(())
    }

    
    pub fn make_offer(ctx: Context<MakeOffer>, amount: u64) -> Result<()> {
        require!(amount > 0, MarketError::InvalidPrice);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_payment_account.to_account_info(),
                    to: ctx.accounts.escrow_payment_account.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            amount,
        )?;

        let offer = &mut ctx.accounts.offer;
        offer.buyer = ctx.accounts.buyer.key();
        offer.nft_mint = ctx.accounts.nft_mint.key();
        offer.amount = amount;
        offer.active = true;
        offer.bump = ctx.bumps.offer;

        Ok(())
    }

    
    pub fn accept_offer(ctx: Context<AcceptOffer>) -> Result<()> {
        require!(ctx.accounts.offer.active, MarketError::OfferNotActive);
        let amount = ctx.accounts.offer.amount;

        let offer_seeds = offer_signer_seeds!(ctx.accounts.offer);
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_payment_account.to_account_info(),
                    to: ctx.accounts.owner_payment_account.to_account_info(),
                    authority: ctx.accounts.offer.to_account_info(),
                },
                &[&offer_seeds[..]],
            ),
            amount,
        )?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.owner_nft_account.to_account_info(),
                    to: ctx.accounts.buyer_nft_account.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            1,
        )?;

        ctx.accounts.offer.active = false;
        Ok(())
    }

    
    pub fn decline_offer(ctx: Context<DeclineOffer>) -> Result<()> {
        require!(ctx.accounts.offer.active, MarketError::OfferNotActive);

        let offer_seeds = offer_signer_seeds!(ctx.accounts.offer);
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_payment_account.to_account_info(),
                    to: ctx.accounts.buyer_payment_account.to_account_info(),
                    authority: ctx.accounts.offer.to_account_info(),
                },
                &[&offer_seeds[..]],
            ),
            ctx.accounts.offer.amount,
        )?;

        ctx.accounts.offer.active = false;
        Ok(())
    }
}


#[account]
pub struct Listing {
    pub seller: Pubkey,
    pub nft_mint: Pubkey,
    pub price: u64,
    pub active: bool,
    pub bump: u8,
}
impl Listing {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 1 + 1;
}

#[account]
pub struct Offer {
    pub buyer: Pubkey,
    pub nft_mint: Pubkey,
    pub amount: u64,
    pub active: bool,
    pub bump: u8,
}
impl Offer {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 1 + 1;
}

#[macro_export]
macro_rules! listing_signer_seeds {
    ($listing:expr) => {
        [b"listing".as_ref(), $listing.nft_mint.as_ref(), &[$listing.bump]]
    };
}

#[macro_export]
macro_rules! offer_signer_seeds {
    ($offer:expr) => {
        [b"offer".as_ref(), $offer.nft_mint.as_ref(), $offer.buyer.as_ref(), &[$offer.bump]]
    };
}


#[derive(Accounts)]
pub struct ListNft<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    pub nft_mint: Account<'info, Mint>,
    #[account(mut, constraint = seller_nft_account.owner == seller.key())]
    pub seller_nft_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed, payer = seller, seeds = [b"vault", nft_mint.key().as_ref()], bump,
        token::mint = nft_mint, token::authority = listing
    )]
    pub vault_nft_account: Account<'info, TokenAccount>,
    #[account(
        init, payer = seller, space = Listing::SIZE,
        seeds = [b"listing", nft_mint.key().as_ref()], bump
    )]
    pub listing: Account<'info, Listing>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Unlist<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut, seeds = [b"listing", listing.nft_mint.as_ref()], bump = listing.bump)]
    pub listing: Account<'info, Listing>,
    #[account(mut, seeds = [b"vault", listing.nft_mint.as_ref()], bump)]
    pub vault_nft_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub seller_nft_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, seeds = [b"listing", listing.nft_mint.as_ref()], bump = listing.bump)]
    pub listing: Account<'info, Listing>,
    #[account(mut, seeds = [b"vault", listing.nft_mint.as_ref()], bump)]
    pub vault_nft_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub buyer_nft_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub buyer_payment_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub seller_payment_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct MakeOffer<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub nft_mint: Account<'info, Mint>,
    pub payment_mint: Account<'info, Mint>,
    #[account(mut)]
    pub buyer_payment_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed, payer = buyer, seeds = [b"escrow", nft_mint.key().as_ref(), buyer.key().as_ref()], bump,
        token::mint = payment_mint,
        token::authority = offer
    )]
    pub escrow_payment_account: Account<'info, TokenAccount>,
    #[account(
        init, payer = buyer, space = Offer::SIZE,
        seeds = [b"offer", nft_mint.key().as_ref(), buyer.key().as_ref()], bump
    )]
    pub offer: Account<'info, Offer>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AcceptOffer<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [b"offer", offer.nft_mint.as_ref(), offer.buyer.as_ref()], bump = offer.bump
    )]
    pub offer: Account<'info, Offer>,
    #[account(mut, seeds = [b"escrow", offer.nft_mint.as_ref(), offer.buyer.as_ref()], bump)]
    pub escrow_payment_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = owner_nft_account.owner == owner.key())]
    pub owner_nft_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub buyer_nft_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner_payment_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct DeclineOffer<'info> {
    
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"offer", offer.nft_mint.as_ref(), offer.buyer.as_ref()], bump = offer.bump
    )]
    pub offer: Account<'info, Offer>,
    #[account(mut, seeds = [b"escrow", offer.nft_mint.as_ref(), offer.buyer.as_ref()], bump)]
    pub escrow_payment_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub buyer_payment_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[error_code]
pub enum MarketError {
    #[msg("Preço inválido.")]
    InvalidPrice,
    #[msg("NFT não está listado.")]
    NotListed,
    #[msg("Você não é o dono deste listing.")]
    NotOwner,
    #[msg("Oferta não está ativa.")]
    OfferNotActive,
}
