use anchor_lang::prelude::*;


declare_id!("GCjrimhJg6nkUMLj2qernKKTDa1NfZsuLbo8wbgexHLH");

pub const MAX_OPTIONS: usize = 8;
pub const QUESTION_MAX_LEN: usize = 140; // tamanho de um "tweet", suficiente pra pergunta


pub const MAX_VOTE_WEIGHT: u8 = 3;

#[program]
pub mod adla_voting {
    use super::*;

    
    pub fn create_poll(
        ctx: Context<CreatePoll>,
        poll_id: u64,
        question: String,
        options_count: u8,
        duration_seconds: i64,
    ) -> Result<()> {
        require!(question.len() <= QUESTION_MAX_LEN, VotingError::QuestionTooLong);
        require!(
            options_count >= 2 && (options_count as usize) <= MAX_OPTIONS,
            VotingError::InvalidOptionsCount
        );
        require!(duration_seconds > 0, VotingError::InvalidDuration);

        let clock = Clock::get()?;
        let poll = &mut ctx.accounts.poll;

        poll.authority = ctx.accounts.authority.key();
        poll.poll_id = poll_id;
        poll.question = question;
        poll.options_count = options_count;
        poll.votes = [0u64; MAX_OPTIONS];
        poll.is_open = true;
        poll.created_at = clock.unix_timestamp;
        poll.ends_at = clock.unix_timestamp + duration_seconds;
        poll.bump = ctx.bumps.poll;

        Ok(())
    }

    
    pub fn cast_vote(ctx: Context<CastVote>, _poll_id: u64, option_index: u8, weight: u8) -> Result<()> {
        let poll = &mut ctx.accounts.poll;
        let clock = Clock::get()?;

        require!(poll.is_open, VotingError::PollClosed);
        require!(clock.unix_timestamp <= poll.ends_at, VotingError::PollExpired);
        require!((option_index as usize) < (poll.options_count as usize), VotingError::InvalidOption);
        require!(weight >= 1 && weight <= MAX_VOTE_WEIGHT, VotingError::InvalidWeight);

        poll.votes[option_index as usize] = poll
            .votes[option_index as usize]
            .checked_add(weight as u64)
            .ok_or(VotingError::Overflow)?;

        let record = &mut ctx.accounts.vote_record;
        record.poll = poll.key();
        record.voter = ctx.accounts.voter.key();
        record.option_index = option_index;
        record.weight = weight;
        record.voted_at = clock.unix_timestamp;
        record.bump = ctx.bumps.vote_record;

        Ok(())
    }

    
    pub fn close_poll(ctx: Context<ClosePoll>, _poll_id: u64) -> Result<()> {
        require_keys_eq!(ctx.accounts.poll.authority, ctx.accounts.authority.key(), VotingError::NotAuthority);
        ctx.accounts.poll.is_open = false;
        Ok(())
    }
}



#[account]
pub struct Poll {
    pub authority: Pubkey,           
    pub poll_id: u64,                
    pub question: String,            
    pub options_count: u8,           
    pub votes: [u64; MAX_OPTIONS],   
    pub is_open: bool,               
    pub created_at: i64,             
    pub ends_at: i64,                
    pub bump: u8,                    
}
impl Poll {
    pub const SIZE: usize =
        8 + 32 + 8 + (4 + QUESTION_MAX_LEN) + 1 + (8 * MAX_OPTIONS) + 1 + 8 + 8 + 1;
}

#[account]
pub struct VoteRecord {
    pub poll: Pubkey,      
    pub voter: Pubkey,     
    pub option_index: u8,  
    pub weight: u8,        
    pub voted_at: i64,     
    pub bump: u8,          
}
impl VoteRecord {
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 1 + 8 + 1;
}


#[derive(Accounts)]
#[instruction(poll_id: u64)]
pub struct CreatePoll<'info> {
    
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Poll::SIZE,
        seeds = [b"poll", poll_id.to_le_bytes().as_ref()],
        bump
    )]
    pub poll: Account<'info, Poll>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(poll_id: u64)]
pub struct CastVote<'info> {
    
    pub voter: Signer<'info>,

   
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"poll", poll_id.to_le_bytes().as_ref()],
        bump = poll.bump
    )]
    pub poll: Account<'info, Poll>,

    #[account(
        init,
        payer = payer,
        space = VoteRecord::SIZE,
        seeds = [b"vote", poll.key().as_ref(), voter.key().as_ref()],
        bump
    )]
    pub vote_record: Account<'info, VoteRecord>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(poll_id: u64)]
pub struct ClosePoll<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"poll", poll_id.to_le_bytes().as_ref()],
        bump = poll.bump
    )]
    pub poll: Account<'info, Poll>,
}



#[error_code]
pub enum VotingError {
    #[msg("Pergunta muito longa (máx 140 caracteres).")]
    QuestionTooLong,
    #[msg("Número de opções inválido (precisa ser entre 2 e 8).")]
    InvalidOptionsCount,
    #[msg("Duração inválida.")]
    InvalidDuration,
    #[msg("Esta enquete já foi encerrada.")]
    PollClosed,
    #[msg("Esta enquete já expirou.")]
    PollExpired,
    #[msg("Opção de voto inválida.")]
    InvalidOption,
    #[msg("Peso de voto inválido (precisa ser entre 1 e MAX_VOTE_WEIGHT).")]
    InvalidWeight,
    #[msg("Overflow ao contar voto (nunca deveria acontecer na prática).")]
    Overflow,
    #[msg("Só a authority pode fechar esta enquete.")]
    NotAuthority,
}
